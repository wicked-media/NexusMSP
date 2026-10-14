package nexusbackup

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"errors"

	"nexusagent/internal/config"
)

// WrapDataKeyForServer uses only the public Backup envelope key pinned in
// policy. The raw AES data key stays in the caller's memory and is never
// included in the returned envelope.
func WrapDataKeyForServer(cfg *config.Config, dataKey []byte) (string, string, error) {
	if len(dataKey) != DataKeyBytes || cfg == nil || cfg.PlatformPolicy == nil || cfg.PlatformPolicy.NexusBackup == nil {
		return "", "", errors.New("backup data-key wrapping is unavailable")
	}
	envelope := cfg.PlatformPolicy.NexusBackup.EnvelopeKey
	keyID, _ := envelope["key_id"].(string)
	pemValue, _ := envelope["public_key_pem"].(string)
	algorithm, _ := envelope["algorithm"].(string)
	if keyID == "" || pemValue == "" || algorithm != "rsa-oaep-sha256" {
		return "", "", errors.New("backup envelope key is not configured")
	}
	block, _ := pem.Decode([]byte(pemValue))
	if block == nil {
		return "", "", errors.New("backup envelope public key is invalid")
	}
	public, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return "", "", errors.New("backup envelope public key is invalid")
	}
	rsaPublic, ok := public.(*rsa.PublicKey)
	if !ok {
		return "", "", errors.New("backup envelope public key is not RSA")
	}
	wrapped, err := rsa.EncryptOAEP(sha256.New(), rand.Reader, rsaPublic, dataKey, nil)
	if err != nil {
		return "", "", errors.New("backup data-key wrapping failed")
	}
	return base64.StdEncoding.EncodeToString(wrapped), keyID, nil
}

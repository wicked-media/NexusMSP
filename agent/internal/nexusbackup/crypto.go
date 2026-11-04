package nexusbackup

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
)

const (
	// DataKeyBytes is AES-256 key material. It must remain in memory until a
	// separately reviewed tenant envelope-key service is available; it must not
	// be written to agent config, logs, manifests, or the Nexus API.
	DataKeyBytes = 32
)

// ChunkDescriptor is payload-safe metadata for one encrypted chunk. It never
// contains a local file path, source name, customer bytes, or encryption key.
type ChunkDescriptor struct {
	Ordinal          int    `json:"ordinal"`
	PlaintextBytes   int    `json:"plaintext_bytes"`
	CiphertextBytes  int    `json:"ciphertext_bytes"`
	PlaintextSHA256  string `json:"plaintext_sha256"`
	CiphertextSHA256 string `json:"ciphertext_sha256"`
	NonceB64         string `json:"nonce_b64"`
}

// NewDataKey creates ephemeral AES-256 material for a future capture session.
// Callers own zeroisation/lifecycle until a server-side envelope-key design is
// released. This function does not persist or transmit the key.
func NewDataKey() ([]byte, error) {
	key := make([]byte, DataKeyBytes)
	if _, err := io.ReadFull(rand.Reader, key); err != nil {
		return nil, fmt.Errorf("generate backup data key: %w", err)
	}
	return key, nil
}

func newGCM(key []byte) (cipher.AEAD, error) {
	if len(key) != DataKeyBytes {
		return nil, errors.New("backup data key must be 32 bytes")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("create AES cipher: %w", err)
	}
	return cipher.NewGCM(block)
}

// EncryptChunk authenticates one payload chunk using a unique random nonce.
// associatedData should contain only stable Nexus IDs and capture sequencing,
// never paths, file names, credentials, or customer data.
func EncryptChunk(key, plaintext, associatedData []byte, ordinal int) ([]byte, ChunkDescriptor, error) {
	gcm, err := newGCM(key)
	if err != nil {
		return nil, ChunkDescriptor{}, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, ChunkDescriptor{}, fmt.Errorf("generate backup chunk nonce: %w", err)
	}
	ciphertext := gcm.Seal(nil, nonce, plaintext, associatedData)
	plainHash := sha256.Sum256(plaintext)
	cipherHash := sha256.Sum256(ciphertext)
	return ciphertext, ChunkDescriptor{
		Ordinal:          ordinal,
		PlaintextBytes:   len(plaintext),
		CiphertextBytes:  len(ciphertext),
		PlaintextSHA256:  fmt.Sprintf("%x", plainHash),
		CiphertextSHA256: fmt.Sprintf("%x", cipherHash),
		NonceB64:         base64.RawStdEncoding.EncodeToString(nonce),
	}, nil
}

// DecryptChunk verifies the cipher hash and GCM authentication before
// returning plaintext. It is for future isolated restore workers only.
func DecryptChunk(key, ciphertext, associatedData []byte, descriptor ChunkDescriptor) ([]byte, error) {
	gcm, err := newGCM(key)
	if err != nil {
		return nil, err
	}
	nonce, err := base64.RawStdEncoding.DecodeString(descriptor.NonceB64)
	if err != nil || len(nonce) != gcm.NonceSize() {
		return nil, errors.New("backup chunk nonce is invalid")
	}
	cipherHash := sha256.Sum256(ciphertext)
	if fmt.Sprintf("%x", cipherHash) != descriptor.CiphertextSHA256 {
		return nil, errors.New("backup chunk ciphertext integrity check failed")
	}
	plaintext, err := gcm.Open(nil, nonce, ciphertext, associatedData)
	if err != nil {
		return nil, errors.New("backup chunk authentication failed")
	}
	plainHash := sha256.Sum256(plaintext)
	if fmt.Sprintf("%x", plainHash) != descriptor.PlaintextSHA256 {
		return nil, errors.New("backup chunk plaintext integrity check failed")
	}
	return plaintext, nil
}

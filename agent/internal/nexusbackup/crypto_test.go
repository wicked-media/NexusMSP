package nexusbackup

import "testing"

func TestEncryptChunkRoundTripAndIntegrity(t *testing.T) {
	key, err := NewDataKey()
	if err != nil {
		t.Fatal(err)
	}
	associated := []byte("tenant-1|client-1|device-1|capture-1|0")
	ciphertext, descriptor, err := EncryptChunk(key, []byte("backup payload test"), associated, 0)
	if err != nil {
		t.Fatal(err)
	}
	if descriptor.PlaintextSHA256 == "" || descriptor.CiphertextSHA256 == "" || descriptor.NonceB64 == "" {
		t.Fatalf("missing integrity descriptor: %#v", descriptor)
	}
	plaintext, err := DecryptChunk(key, ciphertext, associated, descriptor)
	if err != nil {
		t.Fatal(err)
	}
	if string(plaintext) != "backup payload test" {
		t.Fatalf("unexpected plaintext: %q", plaintext)
	}
}

func TestDecryptChunkFailsClosedForChangedAssociatedData(t *testing.T) {
	key, err := NewDataKey()
	if err != nil {
		t.Fatal(err)
	}
	ciphertext, descriptor, err := EncryptChunk(key, []byte("payload"), []byte("stable-ids"), 1)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := DecryptChunk(key, ciphertext, []byte("different-ids"), descriptor); err == nil {
		t.Fatal("changed associated data must fail GCM authentication")
	}
}

func TestEncryptChunkRejectsIncorrectKeyLength(t *testing.T) {
	if _, _, err := EncryptChunk([]byte("short"), []byte("payload"), nil, 0); err == nil {
		t.Fatal("short key must fail")
	}
}

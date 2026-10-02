package nexusbackup

import (
	"bytes"
	"testing"
)

func TestStreamEncryptChunksBoundedSource(t *testing.T) {
	key, err := NewDataKey()
	if err != nil {
		t.Fatal(err)
	}
	var descriptors []ChunkDescriptor
	var received [][]byte
	err = StreamEncrypt(bytes.NewBufferString("abcdefghij"), key, []byte("scope"), 4, func(ciphertext []byte, descriptor ChunkDescriptor) error {
		descriptors = append(descriptors, descriptor)
		received = append(received, ciphertext)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(descriptors) != 3 || descriptors[0].Ordinal != 0 || descriptors[2].PlaintextBytes != 2 {
		t.Fatalf("unexpected descriptors: %#v", descriptors)
	}
	if len(received) != 3 {
		t.Fatalf("expected three encrypted chunks")
	}
}

func TestStreamEncryptRejectsUnboundedChunkSize(t *testing.T) {
	key, err := NewDataKey()
	if err != nil {
		t.Fatal(err)
	}
	if err := StreamEncrypt(bytes.NewBufferString("data"), key, nil, 0, func([]byte, ChunkDescriptor) error { return nil }); err == nil {
		t.Fatal("zero chunk size must fail")
	}
}

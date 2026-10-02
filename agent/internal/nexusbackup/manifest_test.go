package nexusbackup

import "testing"

func testDescriptor(ordinal int) ChunkDescriptor {
	return ChunkDescriptor{Ordinal: ordinal, PlaintextBytes: 10, CiphertextBytes: 26, PlaintextSHA256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", CiphertextSHA256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", NonceB64: "nonce"}
}

func TestCaptureManifestResumePlan(t *testing.T) {
	manifest := CaptureManifest{SchemaVersion: 1, TenantID: "tenant-1", ClientID: "client-1", DeviceID: "device-1", JobID: "job-1", CaptureID: "capture-1", Chunks: []ChunkDescriptor{testDescriptor(0), testDescriptor(1), testDescriptor(2)}}
	pending, err := manifest.PendingChunkOrdinals([]int{1})
	if err != nil {
		t.Fatal(err)
	}
	if len(pending) != 2 || pending[0] != 0 || pending[1] != 2 {
		t.Fatalf("unexpected resume plan: %#v", pending)
	}
}

func TestCaptureManifestRejectsDuplicateChunks(t *testing.T) {
	manifest := CaptureManifest{SchemaVersion: 1, TenantID: "tenant-1", ClientID: "client-1", DeviceID: "device-1", JobID: "job-1", CaptureID: "capture-1", Chunks: []ChunkDescriptor{testDescriptor(0), testDescriptor(0)}}
	if err := manifest.Validate(); err == nil {
		t.Fatal("duplicate chunk ordinal must fail")
	}
}

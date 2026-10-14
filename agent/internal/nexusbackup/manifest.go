package nexusbackup

import (
	"errors"
	"fmt"
	"sort"
)

// CaptureManifest is transfer metadata only. It deliberately has no source
// path, filename, key material, vault URL, or customer payload.
type CaptureManifest struct {
	SchemaVersion int               `json:"schema_version"`
	TenantID      string            `json:"tenant_id"`
	ClientID      string            `json:"client_id"`
	DeviceID      string            `json:"device_id"`
	JobID         string            `json:"job_id"`
	CaptureID     string            `json:"capture_id"`
	Chunks        []ChunkDescriptor `json:"chunks"`
}

func (m CaptureManifest) Validate() error {
	if m.SchemaVersion != 1 {
		return errors.New("unsupported backup manifest schema")
	}
	for label, value := range map[string]string{
		"tenant": m.TenantID, "client": m.ClientID, "device": m.DeviceID, "job": m.JobID, "capture": m.CaptureID,
	} {
		if value == "" {
			return fmt.Errorf("backup manifest %s id is required", label)
		}
	}
	seen := map[int]bool{}
	for _, chunk := range m.Chunks {
		if chunk.Ordinal < 0 || seen[chunk.Ordinal] {
			return errors.New("backup manifest chunk ordinals must be unique non-negative values")
		}
		seen[chunk.Ordinal] = true
		if chunk.PlaintextBytes < 0 || chunk.CiphertextBytes <= chunk.PlaintextBytes || len(chunk.PlaintextSHA256) != 64 || len(chunk.CiphertextSHA256) != 64 || chunk.NonceB64 == "" {
			return fmt.Errorf("backup manifest chunk %d is invalid", chunk.Ordinal)
		}
	}
	return nil
}

// PendingChunkOrdinals returns manifest chunks that have not received an
// immutable-vault acknowledgement. It makes no network call and never treats
// a local write as durable backup evidence.
func (m CaptureManifest) PendingChunkOrdinals(acknowledged []int) ([]int, error) {
	if err := m.Validate(); err != nil {
		return nil, err
	}
	acked := map[int]bool{}
	for _, ordinal := range acknowledged {
		acked[ordinal] = true
	}
	pending := make([]int, 0, len(m.Chunks))
	for _, chunk := range m.Chunks {
		if !acked[chunk.Ordinal] {
			pending = append(pending, chunk.Ordinal)
		}
	}
	sort.Ints(pending)
	return pending, nil
}

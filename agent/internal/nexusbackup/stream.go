package nexusbackup

import (
	"errors"
	"io"
)

const DefaultChunkBytes = 4 * 1024 * 1024

// StreamEncrypt reads an approved source stream incrementally and invokes the
// caller for each encrypted chunk. It never opens a path, writes a temporary
// artifact, uploads, logs payload content, or retains previous plaintext.
func StreamEncrypt(source io.Reader, key, associatedPrefix []byte, chunkBytes int, emit func(ciphertext []byte, descriptor ChunkDescriptor) error) error {
	if source == nil || emit == nil {
		return errors.New("backup stream source and emitter are required")
	}
	if chunkBytes <= 0 || chunkBytes > 64*1024*1024 {
		return errors.New("backup chunk size is outside the permitted range")
	}
	buffer := make([]byte, chunkBytes)
	ordinal := 0
	for {
		read, err := io.ReadFull(source, buffer)
		if read > 0 {
			plaintext := append([]byte(nil), buffer[:read]...)
			associated := append(append([]byte(nil), associatedPrefix...), byte(ordinal>>24), byte(ordinal>>16), byte(ordinal>>8), byte(ordinal))
			ciphertext, descriptor, encryptErr := EncryptChunk(key, plaintext, associated, ordinal)
			for index := range plaintext {
				plaintext[index] = 0
			}
			if encryptErr != nil {
				return encryptErr
			}
			if emitErr := emit(ciphertext, descriptor); emitErr != nil {
				return emitErr
			}
			ordinal++
		}
		if err == io.EOF || err == io.ErrUnexpectedEOF {
			return nil
		}
		if err != nil {
			return err
		}
	}
}

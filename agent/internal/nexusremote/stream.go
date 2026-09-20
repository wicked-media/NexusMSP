package nexusremote

import (
	"context"
	"errors"
	"time"
)

// FrameSource must return a single encoded, bounded screen frame. It runs in
// the attended user session, not in session zero.
type FrameSource interface {
	CaptureJPEG(quality int) ([]byte, error)
}

// FrameSink is the future authenticated relay/upload implementation. It must
// not persist frames as general-purpose endpoint artefacts.
type FrameSink interface {
	SendFrame(context.Context, string, []byte) error
}

type GrantStatus func(sessionID string) (bool, error)
type TransportEvidence func(sessionID, state, detail string) error

type StreamOptions struct {
	FrameInterval time.Duration
	StatusEvery   time.Duration
	JPEGQuality   int
}

func (o StreamOptions) normalized() StreamOptions {
	if o.FrameInterval < 250*time.Millisecond {
		o.FrameInterval = 750 * time.Millisecond
	}
	if o.StatusEvery < time.Second {
		o.StatusEvery = 5 * time.Second
	}
	if o.JPEGQuality < 30 || o.JPEGQuality > 85 {
		o.JPEGQuality = 65
	}
	return o
}

// StreamViewOnly sends frames only while the signed, locally-consented
// session remains valid. Input is deliberately outside this first transport
// slice. Any revocation or status failure stops capture immediately.
func StreamViewOnly(ctx context.Context, session *Session, source FrameSource, sink FrameSink, status GrantStatus, evidence TransportEvidence, options StreamOptions) error {
	if session == nil || source == nil || sink == nil || status == nil || evidence == nil {
		return errors.New("native remote stream dependencies are required")
	}
	options = options.normalized()
	if err := session.Authorize(false, time.Now().UTC()); err != nil {
		return err
	}
	active, err := status(session.grant.SessionID)
	if err != nil || !active {
		return errors.New("native remote grant is no longer active")
	}
	if err := evidence(session.grant.SessionID, "connected", "view-only capture started"); err != nil {
		return err
	}
	defer func() {
		session.Revoke()
		_ = evidence(session.grant.SessionID, "disconnected", "view-only capture stopped")
	}()

	frames := time.NewTicker(options.FrameInterval)
	statusChecks := time.NewTicker(options.StatusEvery)
	defer frames.Stop()
	defer statusChecks.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-statusChecks.C:
			active, err := status(session.grant.SessionID)
			if err != nil || !active {
				return errors.New("native remote grant is no longer active")
			}
		case <-frames.C:
			now := time.Now().UTC()
			if err := session.Authorize(false, now); err != nil {
				return err
			}
			frame, err := source.CaptureJPEG(options.JPEGQuality)
			if err != nil {
				return err
			}
			if len(frame) == 0 || len(frame) > 4*1024*1024 {
				return errors.New("native remote capture produced an invalid frame")
			}
			if err := sink.SendFrame(ctx, session.grant.SessionID, frame); err != nil {
				return err
			}
		}
	}
}

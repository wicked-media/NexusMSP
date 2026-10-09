//go:build !windows

package selfheal

import "context"

// unsupportedPlatform is the non-Windows implementation. The inbuilt component
// repair this package triggers is DISM and sfc on Windows, so off Windows the
// agent reports honestly that the capability is not present instead of
// fabricating a performance guard it cannot honour.
type unsupportedPlatform struct{}

// DefaultPlatform returns the inert platform used on Linux and macOS.
func DefaultPlatform() Platform { return &unsupportedPlatform{} }

func (p *unsupportedPlatform) Sample(context.Context) Sample {
	return Sample{Supported: false}
}

func (p *unsupportedPlatform) Repair(context.Context, []string) RepairRecord {
	return RepairRecord{
		Status: RepairUnsupported,
		Reason: "the inbuilt Windows component repair is a Windows-only capability",
	}
}

func (p *unsupportedPlatform) Elevated() bool { return false }

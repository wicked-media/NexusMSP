//go:build !windows

package telemetry

func collectSecurity() *SecurityInfo          { return nil }
func collectSoftware() []SoftwareInfo         { return nil }
func enrichNICs(existing []NICInfo) []NICInfo { return existing }
func collectHardware() *HardwareInfo          { return nil }

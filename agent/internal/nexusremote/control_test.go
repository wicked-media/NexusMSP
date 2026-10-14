package nexusremote

import "testing"

func TestValidateControlEventAcceptsBoundedPointerAndKeyEvents(t *testing.T) {
	x, y := 0.25, 0.75
	pressed := true
	pointer, err := ValidateControlEvent(ControlEvent{Sequence: 1, Kind: "pointer_button", X: &x, Y: &y, Button: "LEFT", Pressed: &pressed})
	if err != nil || pointer.Button != "left" {
		t.Fatalf("pointer event was rejected or not normalised: %#v, %v", pointer, err)
	}
	key, err := ValidateControlEvent(ControlEvent{Sequence: 2, Kind: "key", Key: "enter", Pressed: &pressed})
	if err != nil || key.Key != "ENTER" {
		t.Fatalf("key event was rejected or not normalised: %#v, %v", key, err)
	}
}

func TestValidateControlEventRejectsUnsafeOrIncompleteEvents(t *testing.T) {
	pressed := true
	for _, event := range []ControlEvent{
		{Sequence: 0, Kind: "key", Key: "A", Pressed: &pressed},
		{Sequence: 1, Kind: "key", Key: "WINDOWS", Pressed: &pressed},
		{Sequence: 2, Kind: "key", Key: "A"},
		{Sequence: 3, Kind: "pointer_move"},
	} {
		if _, err := ValidateControlEvent(event); err == nil {
			t.Fatalf("unsafe event was accepted: %#v", event)
		}
	}
}

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
import base64

from app.services import nexus_backup_envelope


def test_backup_envelope_unwraps_only_matching_current_key(monkeypatch, tmp_path):
    monkeypatch.setattr(nexus_backup_envelope, "PRIVATE_KEY_PATH", tmp_path / "private.pem")
    monkeypatch.setattr(nexus_backup_envelope, "PUBLIC_KEY_PATH", tmp_path / "public.pem")
    material = nexus_backup_envelope.public_material()
    public = serialization.load_pem_public_key(material["public_key_pem"].encode("ascii"))
    wrapped = public.encrypt(b"x" * 32, padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()), algorithm=hashes.SHA256(), label=None))
    assert nexus_backup_envelope.unwrap_data_key(wrapped_key_b64=base64.b64encode(wrapped).decode("ascii"), key_id=material["key_id"]) == b"x" * 32

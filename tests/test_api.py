import io
import shutil
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import config
import storage

DATA = config.MIMII_ROOT


def wav(snr, label, index, mid="id_00"):
    name = "abnormal" if label else "normal"
    return DATA / f"{snr}_dB_fan" / "fan" / mid / name / f"{index:08d}.wav"


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    if not config.MODEL_PATH.exists() or not any(DATA.rglob("*.wav")):
        pytest.skip("Needs a trained model and MIMII recordings (run train.py first).")
    root = tmp_path_factory.mktemp("storage")
    config.STORAGE_DIR = root
    storage.STORAGE_DIR = root
    storage.DB_PATH = root / "monitor.db"
    storage.UPLOAD_DIR = root / "uploads"
    import api
    api.STORAGE_DIR = root
    api.UPLOAD_DIR = root / "uploads"
    with TestClient(api.app) as c:
        yield c


def signup(client, name, company="Acme"):
    r = client.post("/api/auth/register", json={"username": name, "password": "Strong123", "company": company})
    assert r.status_code == 201, r.text
    r = client.post("/api/auth/login", json={"username": name, "password": "Strong123"})
    assert r.status_code == 200
    return {"Authorization": "Bearer " + r.json()["token"]}


def upload(path, field="file"):
    return (field, (path.name, path.read_bytes(), "audio/wav"))


def test_auth_rules(client):
    assert client.get("/api/machines").status_code == 401
    assert client.post("/api/auth/register", json={"username": "ab", "password": "x", "company": "c"}).status_code == 400
    signup(client, "owner_a")
    dup = client.post("/api/auth/register", json={"username": "owner_a", "password": "Strong123", "company": "c"})
    assert dup.status_code == 400
    assert client.get("/api/machines", headers={"Authorization": "Bearer nonsense"}).status_code == 401


def test_lockout(client):
    signup(client, "lock_me")
    for _ in range(5):
        assert client.post("/api/auth/login", json={"username": "lock_me", "password": "wrong"}).status_code == 401
    r = client.post("/api/auth/login", json={"username": "lock_me", "password": "Strong123"})
    assert r.status_code == 429


def test_full_flow(client):
    h = signup(client, "flow_user")
    assert client.get("/api/model", headers=h).json()["ready"] is True
    assert client.post("/api/machines", headers=h, json={"code": "F1", "name": "Fan 1", "type": "robot"}).status_code == 400
    assert client.post("/api/machines", headers=h, json={"code": "F1", "name": "Fan 1", "type": "fan",
                                                          "location": "Hall A"}).status_code == 201
    assert client.post("/api/machines", headers=h, json={"code": "F1", "name": "Dup", "type": "fan"}).status_code == 409
    machine = client.get("/api/machines", headers=h).json()[0]
    mid = machine["id"]
    assert machine["readings"] == 0 and machine["has_ideal"] is False
    assert client.put(f"/api/machines/{mid}", headers=h, json={"code": "F1", "name": "Fan One", "type": "fan",
                                                               "location": "Hall B", "notes": "n"}).status_code == 200

    r = client.post(f"/api/machines/{mid}/analyse", headers=h, files=[upload(wav(0, 0, 1))])
    assert r.status_code == 200, r.text
    a = r.json()
    assert a["result"]["status"] in ("Normal", "Abnormal")
    assert len(a["waveform"]) > 100 and len(a["spectrogram"]["values"]) == config.N_MELS
    assert a["result"]["segments_detail"] and a["result"]["checks"]
    key = a["analysis_id"]

    assert client.get(f"/api/analyses/{key}/report.pdf", headers=h).content[:4] == b"%PDF"
    assert client.post(f"/api/analyses/{key}/save", headers=h).status_code == 200
    assert client.post(f"/api/analyses/{key}/save", headers=h).status_code == 409

    two = [upload(wav(6, 0, i), 'files') for i in (2, 3)]
    r = client.post(f"/api/machines/{mid}/ideal", headers=h, files=two)
    assert r.status_code == 400
    r = client.post(f"/api/machines/{mid}/ideal", headers=h, files=[upload(wav(6, 1, i), 'files') for i in (1, 2, 3)])
    assert r.status_code == 422
    r = client.post(f"/api/machines/{mid}/ideal", headers=h, files=[upload(wav(6, 0, i), 'files') for i in (4, 5, 6)])
    assert r.status_code == 200, r.text
    assert client.get(f"/api/machines/{mid}/ideal", headers=h).json()["ideal"]["clips"] == 3

    a2 = client.post(f"/api/machines/{mid}/analyse", headers=h, files=[upload(wav(-6, 1, 1))]).json()
    assert a2["degradation"] is not None and a2["comparison"] is not None
    client.post(f"/api/analyses/{a2['analysis_id']}/save", headers=h)

    batch = client.post("/api/batch/analyse", headers=h,
                        files=[("files", (wav(0, 0, i).name, wav(0, 0, i).read_bytes(), "audio/wav")) for i in (7, 8)],
                        data={"machine_ids": [str(mid), str(mid)]})
    assert batch.status_code == 200, batch.text
    ids = [row["analysis_id"] for row in batch.json()["rows"]]
    assert client.post("/api/analyses/save", headers=h, json={"ids": ids}).json()["saved"] == 2

    hist = client.get(f"/api/machines/{mid}/history", headers=h).json()
    assert len(hist["rows"]) == 4 and hist["ideal"] is not None
    assert "health" in client.get(f"/api/machines/{mid}/history.csv", headers=h).text
    dash = client.get("/api/dashboard", headers=h).json()
    assert dash["totals"]["machines"] == 1 and dash["totals"]["readings"] == 4 and len(dash["activity"]) == 14

    reading = hist["rows"][0]["id"]
    assert client.get(f"/api/readings/{reading}/report.pdf", headers=h).content[:4] == b"%PDF"
    assert client.delete(f"/api/readings/{reading}", headers=h).status_code == 200
    assert client.delete(f"/api/readings/{reading}", headers=h).status_code == 404
    assert client.delete(f"/api/machines/{mid}/ideal", headers=h).status_code == 200
    assert client.delete(f"/api/machines/{mid}", headers=h).status_code == 200
    assert client.get(f"/api/machines/{mid}/history", headers=h).status_code == 404


def test_isolation_and_limits(client):
    a, b = signup(client, "tenant_a"), signup(client, "tenant_b")
    client.post("/api/machines", headers=a, json={"code": "X1", "name": "X", "type": "fan"})
    mid = client.get("/api/machines", headers=a).json()[0]["id"]
    assert client.get("/api/machines", headers=b).json() == []
    for method, url in [("get", f"/api/machines/{mid}/history"), ("delete", f"/api/machines/{mid}"),
                        ("get", f"/api/machines/{mid}/ideal")]:
        assert getattr(client, method)(url, headers=b).status_code == 404
    assert client.post(f"/api/machines/{mid}/analyse", headers=b, files=[upload(wav(0, 0, 1))]).status_code == 404
    key = client.post(f"/api/machines/{mid}/analyse", headers=a, files=[upload(wav(0, 0, 1))]).json()["analysis_id"]
    assert client.post(f"/api/analyses/{key}/save", headers=b).status_code == 404
    assert client.get(f"/api/analyses/{key}/report.pdf", headers=b).status_code == 404

    bad = client.post(f"/api/machines/{mid}/analyse", headers=a, files=[("file", ("notes.exe", b"abc", "x"))])
    assert bad.status_code == 415
    empty = client.post(f"/api/machines/{mid}/analyse", headers=a, files=[("file", ("a.wav", b"", "x"))])
    assert empty.status_code == 400
    junk = client.post(f"/api/machines/{mid}/analyse", headers=a, files=[("file", ("a.wav", b"not audio", "x"))])
    assert junk.status_code == 422
    traversal = client.post(f"/api/machines/{mid}/analyse", headers=a,
                            files=[("file", ("..\\..\\evil.wav", wav(0, 0, 1).read_bytes(), "audio/wav"))])
    assert traversal.status_code == 200
    assert traversal.json()["file_name"] == "evil.wav"

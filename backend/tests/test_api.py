import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")

from fastapi.testclient import TestClient  # noqa: E402

from wassily.api.app import create_app  # noqa: E402
from wassily.config.settings import load_config  # noqa: E402
from wassily.engine.simulator import Market  # noqa: E402
from wassily.engine.trainer import TrainOptions  # noqa: E402
from wassily.utils.timeutil import now_ms  # noqa: E402

N_TOKENS = 260


@pytest.fixture(scope="module")
def client():
    app = create_app(load_config({"DATA_SOURCE": "simulated", "PERSIST": "false"}), start_runtime=False)
    with TestClient(app) as c:
        agent = app.state.runtime.agent
        agent.train_options = TrainOptions(resamples=20)
        for t in Market(21).history(N_TOKENS, now_ms()):
            agent.upsert(t, announce=False)
        agent.retrain_sync()
        yield c


def test_health(client):
    body = client.get("/api/health").json()
    assert body["ok"] and body["source"] == "simulated" and body["tokens"] == N_TOKENS


def test_state(client):
    body = client.get("/api/state").json()
    assert body["bound"] == "hoeffding" and len(body["tokens"]) == N_TOKENS
    model = body["latest_model"]
    assert set(model["gates"]) == {"n_samples", "n_positive", "auc_std", "time_split"}
    assert model["blocked_by"] == "n_samples"  # 260 tokens is far from 2,000
    assert 0 <= model["jar_level"] <= 0.95
    assert len(body["findings"]["hour_counts"]) == 24


def test_model_history(client):
    runs = client.get("/api/model/history?days=1").json()["runs"]
    assert len(runs) == 1 and runs[0]["n"] == N_TOKENS


def test_current_cycle_and_lookup(client):
    current = client.get("/api/ideas/current").json()
    assert 0 < len(current["candidates"]) <= 100 and len(current["generator_sha"]) == 64
    by_id = client.get(f"/api/ideas/cycle/{current['cycle_id']}").json()
    assert by_id["candidates"] == current["candidates"]
    assert client.get("/api/ideas/cycle/1").status_code == 404
    assert client.get("/api/ideas/current?persona=bayes").json()["persona"] == "bayes"


def test_commitments_from_memory(client):
    current = client.get("/api/ideas/current").json()
    body = client.get(f"/api/ideas/commitments?from={current['cycle_id']}").json()
    assert body["count"] == len(current["candidates"])


def test_records_filter_and_generator(client):
    assert client.get("/api/ideas/eliminated").json()["items"] == []
    assert client.get("/api/ideas/exclusions").json()["items"] == []
    rules = client.get("/api/ideas/filter").json()["rules"]
    assert rules[-1] == {"id": "near_duplicate", "label": "No near-duplicates of deployed tokens", "pattern": None}
    assert "def generate_cycle" in client.get("/api/ideas/generator").json()["source"]


def test_open_data(client):
    csv_text = client.get("/api/dataset.csv").text
    assert csv_text.startswith("mint,name,symbol") and len(csv_text.strip().splitlines()) == N_TOKENS + 1
    methodology = client.get("/api/methodology.json").json()
    assert methodology["features"]["d"] == 28 and methodology["bound"]["id"] == "hoeffding"


def test_bootstrap_floor(client):
    body = client.get("/api/bootstrap?n=400&npos=80&auc=0.7").json()
    assert body["n_positive"] == 80 and 0.5 < body["boot_lower"] < 0.7
    assert client.get("/api/bootstrap?n=5").status_code == 422

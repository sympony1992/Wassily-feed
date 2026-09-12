import asyncio
from dataclasses import replace

import pytest
from conftest import NOW, NOW_MS

from wassily.config.personas import PERSONAS
from wassily.config.settings import load_config
from wassily.engine.simulator import Market
from wassily.engine.trainer import TrainOptions
from wassily.runtime.agent import Agent
from wassily.runtime.events import EventBus
from wassily.runtime.runtime import Runtime
from wassily.store.persistence import Persistence
from wassily.utils.timeutil import DAY_MS, iso


def make_agent(**kw) -> Agent:
    return Agent("hoeffding", None, 90, train_options=TrainOptions(resamples=20), **kw)


@pytest.fixture(scope="module")
def history():
    return Market(5).history(240, NOW_MS)


def seeded(history, **kw) -> Agent:
    agent = make_agent(**kw)
    for t in history:
        agent.upsert(t, announce=False)
    return agent


def test_counters_and_warmup(history):
    agent = seeded(history)
    agent.upsert(replace(history[0], mint="0xpending", status="pending"), announce=False)
    c = agent.counters()
    assert c["tokens"] == 241 and c["pending"] == 1 and c["labelled"] == 240
    assert c["passed"] + c["stalled"] == 240
    w = agent.warmup()
    assert w["watching"] == 1 and w["next_label_at"] and not w["ready"]


def test_retrain_publishes_a_cycle_for_every_persona(history):
    agent = seeded(history)
    run = agent.retrain_sync(at=NOW)
    assert agent.latest is run and run.ran_at == iso(NOW) and run.source == "simulated"
    for p in PERSONAS:
        cycle = agent.ledger(p.id).current
        assert cycle is not None and cycle.run_id == run.run_id
    assert agent.warmup()["ready"]


def test_events_are_published(history, monkeypatch):
    agent = make_agent()
    seen = []
    monkeypatch.setattr(agent.events, "publish", lambda kind, data: seen.append(kind))
    for t in history:
        agent.upsert(t)
    agent.retrain_sync(at=NOW)
    assert seen.count("token") == len(history)
    assert seen.count("cycle") == len(PERSONAS) and seen[-1] == "model"


def test_an_empty_bus_is_still_the_shared_bus():
    bus = EventBus()
    assert len(bus) == 0 and Agent(events=bus).events is bus
    rt = Runtime(load_config({"DATA_SOURCE": "simulated", "PERSIST": "false"}))
    assert rt.agent.events is rt.events


def test_upserts_reach_a_stream_subscriber(history):
    rt = Runtime(load_config({"DATA_SOURCE": "simulated", "PERSIST": "false"}))

    async def scenario():
        async with rt.events.subscribe() as queue:
            rt.agent.upsert(history[0])
            event = await asyncio.wait_for(queue.get(), 1)
        return event

    event = asyncio.run(scenario())
    assert event.kind == "token" and event.data["token"] is history[0]


def test_a_copycat_deployment_becomes_an_exclusion(history):
    agent = seeded(history)
    agent.retrain_sync(at=NOW)
    name = agent.ledger().current.candidates[0].name
    copycat = Market(9).arrival(NOW_MS + 5 * DAY_MS, name)
    agent.upsert(copycat)
    record = agent.ledger().exclusions[0]
    assert record.name == name and record.deployed_mint == copycat.mint and record.time_gap_seconds > 0
    assert name.lower() in agent.ledger().stolen


def test_snapshot_and_commitments_survive_a_restart(history, tmp_path):
    persistence = Persistence(tmp_path)
    agent = seeded(history, persistence=persistence)
    agent.retrain_sync(at=NOW)
    lines = persistence.log_file.read_text(encoding="utf-8").splitlines()
    assert len(lines) == sum(len(agent.ledger(p.id).current.candidates) for p in PERSONAS)

    restarted = make_agent()
    restarted.restore(persistence.load())
    assert len(restarted.tokens) == len(agent.tokens)
    assert restarted.latest == agent.latest
    assert restarted.ledger().current.candidates == agent.ledger().current.candidates
    assert restarted.retrain_sync(at=NOW).run_id == agent.latest.run_id + 1


def test_version_one_snapshots_restore_into_the_default_persona(history):
    agent = seeded(history)
    agent.retrain_sync(at=NOW)
    snap = agent.snapshot()
    legacy = {"version": 1, "runId": snap["runId"], "tokens": snap["tokens"], "runs": snap["runs"],
              "ledger": snap["ledgers"]["hoeffding"]}
    old = make_agent()
    old.restore(legacy)
    assert old.ledger("hoeffding").current.cycle_id == agent.ledger("hoeffding").current.cycle_id
    assert old.ledger("bayes").current is None

import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from split import file_splits


def build(strategy_count=40):
    rows, paths = [], []
    for mid in ("id_00", "id_02"):
        for label, name in ((0, "normal"), (1, "abnormal")):
            for snr in (6, 0, -6):
                for n in range(strategy_count):
                    paths.append(f"/d/{snr}_dB_fan/fan/{mid}/{name}/{n:08d}.wav")
                    rows.append({"file": len(paths) - 1, "source": "mimii", "machine": "fan",
                                 "mid": mid, "label": label, "snr": snr})
    return pd.DataFrame(rows), paths


def test_blocked_split_is_ordered_and_keeps_snr_copies_together():
    meta, paths = build()
    meta["split"] = file_splits(meta, paths, "blocked")
    meta["name"] = [p.rsplit("/", 1)[1] for p in paths]
    meta["number"] = meta["name"].str[:8].astype(int)
    for _, group in meta.groupby(["mid", "label"]):
        assert group["split"].groupby(group["number"]).nunique().max() == 1
        train_max = group.loc[group["split"] == "train", "number"].max()
        val = group.loc[group["split"] == "val", "number"]
        test_min = group.loc[group["split"] == "test", "number"].min()
        assert train_max < val.min() and val.max() < test_min
    share = meta.drop_duplicates(["mid", "label", "number"])["split"].value_counts(normalize=True)
    assert abs(share["train"] - 0.65) < 0.05 and abs(share["test"] - 0.20) < 0.05


def test_random_split_keeps_snr_copies_together():
    meta, paths = build()
    meta["split"] = file_splits(meta, paths, "random")
    meta["number"] = [int(p.rsplit("/", 1)[1][:8]) for p in paths]
    assert meta.groupby(["mid", "label", "number"])["split"].nunique().max() == 1
    assert set(meta["split"]) == {"train", "val", "test"}

# Audio Guard

Acoustic condition monitoring for factory machines (MIMII dataset).

## Train and evaluate

    python train.py
    python evaluate.py

`SPLIT_MODE` in `config.py` selects the test protocol:

- `file` (default): every recording is assigned to train, validation or test by a stable hash of its machine ID, label and file name, so the 6, 0 and -6 dB copies of one recording always stay together. Test recordings are never used for training or tuning.
- `machine`: one machine ID (`HOLDOUT_IDS`) is held out completely.

## Run the API

    uvicorn api:app --reload --port 8000

Interactive documentation: http://localhost:8000/api/docs

Environment variables: `MH_SECRET` (token signing key), `MH_ALLOW_REGISTER=0` (disable sign-up), `MH_CORS` (allowed origins).

## Tests

    python -m pytest tests -q

## Streamlit version

    streamlit run app.py

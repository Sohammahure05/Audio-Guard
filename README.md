# Audio Guard

Acoustic condition monitoring for factory machines (MIMII dataset).

## Train and evaluate

    python train.py
    python evaluate.py

`SPLIT_MODE` in `config.py` selects the test protocol:

- `file` (default): every recording is assigned to train, validation or test by a stable hash of its machine ID, label and file name, so the 6, 0 and -6 dB copies of one recording always stay together. Test recordings are never used for training or tuning.
- `machine`: one machine ID (`HOLDOUT_IDS`) is held out completely.

`SPLIT_STRATEGY = "blocked"` keeps neighbouring recordings together in the same split, which is the stricter test and the one to report.

## Run the API

    uvicorn api:app --reload --port 8000

Interactive documentation: http://localhost:8000/api/docs

Environment variables: `MH_SECRET` (token signing key), `MH_ALLOW_REGISTER=0` (disable sign-up), `MH_CORS` (allowed origins).

## Run the web app

In one terminal, from the project folder:

    uvicorn api:app --reload --port 8000

In a second terminal:

    cd frontend
    npm install
    npm run dev

Then open http://localhost:5173. For a single-server setup, run `npm run build` in `frontend` and open http://localhost:8000.

## Sound drift

The drift figure compares the spectral shape of a reading with the machine's ideal. It does not say whether the machine is faulty. Its limits are set from how much the ideal clips vary among themselves, so rebuild the ideal from 3 to 10 healthy WAV clips recorded the same way as later readings.

## Tests

    python -m pytest tests -q

## Streamlit version

    streamlit run app.py

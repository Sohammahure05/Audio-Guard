# Machine Health frontend

Start the API from the project root, then the frontend:

    uvicorn api:app --port 8000
    cd frontend
    npm install
    npm run dev

Open http://localhost:5173. Requests to /api are proxied to http://127.0.0.1:8000.

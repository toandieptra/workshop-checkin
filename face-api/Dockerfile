FROM python:3.11-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 \
    INSIGHTFACE_HOME=/root/.insightface

# build deps cho insightface (cython, opencv libs)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl build-essential cmake libglib2.0-0 libgl1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install numpy==1.26.4 && pip install -r requirements.txt

COPY app ./app

EXPOSE 8428
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8428"]

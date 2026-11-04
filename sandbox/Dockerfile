FROM python:3.11-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production

# Install essential runtime tools, curl, git, sqlite3, jq, bash
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    gnupg \
    git \
    sqlite3 \
    jq \
    bash \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 20 LTS & npm
RUN mkdir -p /etc/apt/keyrings && \
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg && \
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" > /etc/apt/sources.list.d/nodesource.list && \
    apt-get update && apt-get install -y --no-install-recommends nodejs && \
    npm install -g ts-node typescript && \
    rm -rf /var/lib/apt/lists/*

# Install common Python security testing & exploit verification libraries
RUN pip install --no-cache-dir \
    requests \
    cryptography \
    pyjwt \
    httpx \
    pydantic \
    beautifulsoup4

WORKDIR /workspace
CMD ["python", "reproducer.py"]

FROM debian:bullseye-slim

RUN apt-get update && \
    apt-get install -y gcc && \
    rm -rf /var/lib/apt/lists/*

# Create non-root user for security
RUN useradd -m -s /bin/bash coderunner && \
    mkdir -p /code && \
    chown coderunner:coderunner /code

# Set resource limits
WORKDIR /code
USER coderunner

# Default command - compile and execute a C file
CMD ["sh", "-c", "gcc -O2 -o /tmp/solution /code/solution.c && /tmp/solution"]

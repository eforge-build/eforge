FROM node:22-slim

RUN apt-get update && apt-get install -y git curl && rm -rf /var/lib/apt/lists/*

# Claude Code installs to ~/.local/bin
ENV PATH="/root/.local/bin:$PATH"

# Install Claude Code via official installer
RUN curl -fsSL https://claude.ai/install.sh | bash

# Git identity for eforge operations
RUN git config --global user.name "eforge-test" && \
    git config --global user.email "test@eforge.build"

WORKDIR /workspace

# Initialize a minimal test project
RUN git init && git commit --allow-empty -m "init"

CMD ["bash"]

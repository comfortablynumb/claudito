FROM claudito-agent:latest

USER root
RUN curl -fsSL https://go.dev/dl/go1.22.0.linux-amd64.tar.gz | tar -C /usr/local -xzf -

USER claudito
ENV PATH="/usr/local/go/bin:/home/claudito/go/bin:${PATH}"
ENV GOPATH="/home/claudito/go"
WORKDIR /workspace

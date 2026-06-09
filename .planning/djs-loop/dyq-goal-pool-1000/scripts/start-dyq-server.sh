#!/bin/bash
# 启动 dyq-server，注入 POKECLAW_OPERATOR_STATUS_PATH 指向端侧证据包
set -u
cd /mnt/e/code/dyq
POKECLAW_OPERATOR_STATUS_PATH="${1:-/mnt/e/code/PokeClaw/artifacts/dyq39-cloud-overview/20260607-round39/operator-status.json}" nohup mvn -pl dyq-server spring-boot:run -DskipTests -Dmaven.test.skip=true > /tmp/dyq-server-r40.log 2>&1 &
echo "Started dyq-server PID=$! LOG=/tmp/dyq-server-r40.log PATH=$POKECLAW_OPERATOR_STATUS_PATH"

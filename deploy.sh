#!/bin/bash
set -e
cd /var/www/dev.canmatchy.com
git pull origin mainv2
npm install --omit=dev
sudo systemctl restart coupe-humour
echo "Deployed $(git rev-parse --short HEAD)"
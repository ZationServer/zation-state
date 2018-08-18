FROM node:8-slim

MAINTAINER Zation

LABEL version="6.0.0"
LABEL description="Docker file for Zation Cluster State Server"

RUN mkdir -p /usr/src/
WORKDIR /usr/src/
COPY . /usr/src/

RUN npm install .

EXPOSE 7777

CMD ["npm", "start"]

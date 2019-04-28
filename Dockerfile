FROM node:8.9

MAINTAINER Zation

LABEL version="6.0.3"
LABEL description="Docker file for Zation Cluster State Server"

RUN mkdir -p /usr/src/
WORKDIR /usr/src/
COPY . /usr/src/

RUN npm install

RUN npm install pm2 -g

EXPOSE 7777

CMD ["npm", "run", "start:docker"]
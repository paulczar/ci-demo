FROM node:0.10.40

ENV URL=localhost PORT=5000 HOST=0.0.0.0 DB_HOST=mysql DB_USER=ghost DB_PASS=ghost DB_NAME=ghost

WORKDIR /ghost

COPY . /ghost

RUN npm install --production

EXPOSE 5000

CMD ["npm", "start", "--production"]

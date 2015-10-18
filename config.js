// # Ghost Configuration
// Setup your Ghost install for various [environments](http://support.ghost.org/config/#about-environments).

// Ghost runs in `development` mode by default. Full documentation can be found at http://support.ghost.org/config/

var path = require('path'),
    config;

config = {
    production: {
        url: "http://" + process.env.URL + ":" + process.env.PORT,
        mail: {},
        database: {
            client: 'mysql',
            connection: {
                host     : process.env.DB_HOST,
                user     : process.env.DB_USER,
                password : process.env.DB_PASS,
                database : process.env.DB_NAME,
                charset  : 'utf8'
            }
        },
        server: {
            host: process.env.HOST,
            port: process.env.PORT
        }
    },
    development: {
        url: "http://" + process.env.URL + ":" + process.env.PORT,
        database: {
            client: 'sqlite3',
            connection: {
                filename: path.join(__dirname, '/content/data/ghost-dev.db')
            },
            debug: false
        },
        server: {
            host: process.env.HOST,
            port: process.env.PORT
        },
        paths: {
            contentPath: path.join(__dirname, '/content/')
        }
    }
};

module.exports = config;
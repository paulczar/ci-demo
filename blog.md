## About

This blog post describes (and is hosted on) a demonstration of a CI/CD pipeline where each Pull Request creates an ephemeral environment that could be reviewed as part of the github review process as well as automatically deploying and upgrading a staging and a production environment.

I chose to demonstrate this using _only_ opensource products. This means I am running everything from the _IAAS_ layer up. You could quite easily skip OpenStack and run this in AWS or Digital Ocean.

This is not intended to be a detailed "how to build a *AAS platform" so while I mentioned each layer's underlying technology I will not go into detail until we are at the application itself.

## Infrastructure

1. [OpenStack](http://www.openstack.org/) was installed across a set of physical machines using [Ursula](https://github.com/blueboxgroup/ursula).
2. A 3 node [DEIS](http://deis.io/)
 cluster was then installed on [OpenStack](http://www.openstack.org/) using the terraform instructions [here](https://github.com/paulczar/deis/tree/openstack_provision_script/contrib/openstack).
3. A standalone coreos node was created using [Terraform](https://terraform.io/) 
4. A self replicating database was deployed on the [DEIS](http://deis.io/) nodes using the [paulczar/percona-galera](https://github.com/paulczar/docker-percona_galera) docker image which uses [etcd](https://coreos.com/etcd/) to find each other and form a cluster.
5. A mysql proxy was deployed on the standalone node using the [paulczar/maxscale](https://hub.docker.com/r/paulczar/maxscale/) image which discovers the databases via [etcd](https://coreos.com/etcd/).
6. [Jenkins](http://jenkins-ci.org/) was deployed to standalone node using the standard [jenkins docker image](https://hub.docker.com/_/jenkins/).

## Application

The application I chose to demo is the [Ghost blogging platform](https://ghost.org/download/) (literally the blog you are reading right now).   I chose it because it's a fairly simple app with a backing service ( mysql ).  The source including my `Dockerfile` and customizations can be found in the [paulczar/ci-demo](https://github.com/paulczar/ci-demo) github repository.

## Development Environment

Docker combined with `docker-compose` makes for an excellent development environment and I have configured it to launch two containers:

```
ghost:
  build: .
  ports:
    - 5000:5000
  volumes:
    - .:/ghost
  environment:
    URL: http://localhost:5000
    DB_USER: root
    DB_PASS: ghost
  links:
    - mysql
mysql:
  image: percona
  ports:
   - "3306:3306"
  environment:
    MYSQL_ROOT_PASSWORD: ghost
    MYSQL_DATABASE: ghost
```

I also included an `aliases` file with some useful aliases for common tasks

```
alias dc="docker-compose"
alias npm="docker-compose run --rm --no-deps ghost npm install --production"
alias up="docker-compose up -d mysql && sleep 5 && docker-compose up -d --force-recreate ghost"
alias test="docker run -ti --entrypoint='sh' --rm test /app/test"
alias build="docker-compose build"
```

Running the development environment locally is as simple as cloning the repo and calling a few commands from the `aliases` file.  The following examples show how I added [s3 support for storing images](https://www.npmjs.com/package/ghost-s3-storage).

```
$ git clone https://github.com/paulczar/ci-demo.git
$ cd ci-demo
$ . ./aliases
$ npm
> sqlite3@3.0.8 install /ghost/node_modules/sqlite3
> node-pre-gyp install --fallback-to-build
...
...
$ docker-compose run --rm --no-deps ghost npm install --save ghost-s3-storage
ghost-s3-storage@0.2.2 node_modules/ghost-s3-storage
├── when@3.7.4
└── aws-sdk@2.2.17 (xmlbuilder@0.4.2, xml2js@0.2.8, sax@0.5.3)
$ up
```

Docker Compose v1.5 allows variable substitution so I can pull AWS credentials from env variables which means they don't need to be saved to git and each dev can use their own bucket etc.  This is done as simply as adding these lines to the `docker-compose.yml` file in the `environment` section:

```
ghost:
  environment:
    S3_ACCESS_KEY_ID: ${S3_ACCESS_KEY_ID}
    S3_ACCESS_KEY: ${S3_ACCESS_KEY}
```

As you can see by the image below ... which is hosted in the s3 bucket... things must be working.

![](https://ci-demo-ghost-images.s3.amazonaws.com/2015/Nov/ghost_blog-1447652183265.png)

## Continuous Integration / Deployment

### Pull Request

Development workflow is `feature branch` based and `PRs` and `merges` to the git repo will kick of CI events.  Thus I'll want to create a feature branch of my changes and create a PR from that:

```
$ git checkout -b s3_for_images
Switched to a new branch 's3_for_images'
$ git add .
$ git commit -m 'use s3 to store images'
[s3_for_images 55e1b3d] use s3 to store images
 8 files changed, 170 insertions(+), 2 deletions(-)
 create mode 100644 content/storage/ghost-s3/index.js
$ git push origin s3_for_images 
Counting objects: 14, done.
Delta compression using up to 8 threads.
Compressing objects: 100% (12/12), done.
Writing objects: 100% (14/14), 46.57 KiB | 0 bytes/s, done.
Total 14 (delta 5), reused 0 (delta 0)
To git@github.com:paulczar/ci-demo.git
 * [new branch]      s3_for_images -> s3_for_images
```

![IMAGE OF GITHUB PR PAGE](http://)

When a new `Pull Request` is created by an authorized user against the `development` branch github will fire a webhook to jenkins which will run any tests and create and deploy to a new ephemeral application in `deis` named for `PR-xx-ghost`.  Once tests are run the app can be viewed at http://pr-xx-ghost.ci-demo.paulczar.net by anyone wishing to review the PR.  Subsequent updates to the PR will simply update the deployed application.

![IMAGE JENKINS JOB](http://)

Once Jenkins has provided the URL to the epheneral application we can test it there and confirm everything is working fine and you can upload photos etc.

In this case while the blog worked, images could not be uploaded.  This is because it doesn't have any s3 credentials.  I can manually fix this by running `deis config:set -a ghost S3_ACCESS_KEY_ID=*** S3_ACCESS_KEY=***`, if I want this to be a permanent feature I would update the PR builder job in Jenkins to do this as part of the build.

#### Staging

The `development` branch is protected, and will only accept PRs that have passed tests and had a successful demo environment deployed.

When the `Pull Request` is merged it will fire off two webhooks to Jenkins.  The first will delete the demo application for that PR and the second will update the staging environment in deis (http://stage-ghost.ci-demo.paulczar.net) with the contents of the `development` branch.

![IMAGE JENKINS JOB](http://)

Originally when I started building this demo I had assumed that being able to perform actions on PR merges/closes would be simple, but I quickly discovered none of the CI tools support performing actions on PR close. Thankfully I was able to find a useful [blog](http://chloky.com/github-json-payload-in-jenkins/) post that described how to set up a custom job with a webhook that could process the github payload.


#### Production

An application `ghost` lives on the DEIS PAAS and DEIS is configured to point it at a production database hosted on the clustered Percona database via the DB loadbalancer.

To promote the current `development` branch to production, all is needed is a PR into the `master` branch which will kick of some tests ( currently a noop in jenkins ).

The `master` branch is protected and tests must be passed before the PR can be merged into it.  Once merged a final webhook will fire to jenkins which will update the production application in deis (http://ghost.ci-demo.paulczar.net).

## Caveats

Currently the `PR` demo environments spin up with a local sqlite database for the sake of getting to the rest of the steps.  I will be updating this soon with scripts that will create a new database based on the staging database.

There is a jenkins job called `UPDATE_STAGING_DATABASE` which will when run ( manually ) delete the staging database and create a new one from a backup of the production database. 


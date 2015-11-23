# Merry PaaSmas and a Very Continuous Integration

Docker and the ecosystem around it have done some great things for developers, but from an operational standpoint, it's mostly just the same old issues with a fresh coat of paint. Real change happens when we change our perspective from _Infrastructure_ (as a Service) to _Platform_ (as a Service), and when the ultimate deployment artifact is a running application instead of a virtual machine.

Even Kubernates still feels a lot like IaaS - just with containers instead of virtual machines. To be fair, there are already some platforms out there that shift the user experience towards the application (Cloud Foundry and Heroku come to mind), but many of them have a large operations burden, or are provided in a SaaS model only.

In the Docker ecosystem we are starting to see more of these types of platforms, the first of which was [Dokku](https://github.com/progrium/dokku) which started as a single machine [Heroku](http://heroku.com) replacement written in about 100 lines of Bash. Building on top of that work other, richer systems like [Deis](http://Deis.io) and [Flynn](http://flynn.io) have emerged, as well as custom solutions built in-house, like Yelp's [PaaSta](https://github.com/Yelp/PaaSta).

Actions speak louder than words, so I decided to document (and demonstrate) a platform built from the ground up (using Open Source projects) and then deploy an application to it via a Continuous Integration/Deployment (CI/CD) pipeline.

You could (and probably would) use a public cloud provider for some (or all) of this stack; however, I wanted to demonstrate that a system like this can be built and run internally, as not everybody is able to use the public cloud.

As I wrote this I discovered that while figuring out the right combination of tools to run was a fun process, the really interesting stuff was building the actual CI/CD pipeline to deploy and run the application itself. This means that while I'll briefly describe the underlying infrastructure, I will not be providing a detailed installation guide.

## Infrastructure

While an IaaS is not strictly necessary here (I could run Deis straight on bare metal), it makes sense to use something like [OpenStack](http://www.openstack.org/) as it provides excellent APIs to spin up VMs. I installed OpenStack across across a set of physical machines using [Blue Box's](https://www.blueboxcloud.com/) [Ursula](https://github.com/blueboxgroup/ursula).

Next the PaaS itself. I have familiarity with [Deis](http://Deis.io/) already and I really like its (Heroku-esque) user experience. I deployed a three node Deis cluster on OpenStack using the [Terraform](https://terraform.io/) instructions [here](https://github.com/paulczar/Deis/tree/openstack_provision_script/contrib/openstack).

I also deployed an additional three [CoreOS](https://coreos.com) nodes using [Terraform](https://terraform.io/) on which I ran [Jenkins](http://jenkins-ci.org/) using the standard [Jenkins Docker image](https://hub.docker.com/_/jenkins/).

Finally, there is a three-node Percona database cluster running on the CoreOS nodes, itself fronted by a load balancer, both of which use [etcd](https://coreos.com/etcd/) for auto-discovery. Docker images are available for both the [cluster](https://github.com/paulczar/docker-percona_galera) and the [load balancer](https://hub.docker.com/r/paulczar/maxscale/).

## Ghost

The application I chose to demo is the [Ghost blogging platform](https://ghost.org/download/). I chose it because it's a fairly simple app with well-known backing service (MySQL). The source, including my `Dockerfile` and customizations, can be found in the [paulczar/ci-demo](https://github.com/paulczar/ci-demo) GitHub repository.

The hostname and database credentials of the MySQL load balancer are passed into Ghost via [environment variables](http://12factor.net/config) (injected by Deis) to provide a suitable database [backing service](http://12factor.net/backing-services).

For development, I wanted to follow the [GitHub Flow](https://guides.github.com/introduction/flow/) methodology as much as possible. My merge/deploy steps are a bit different, but the basic flow is the same. This allows me to use GitHub's notification system to trigger Jenkins jobs when Pull Requests are created or merged.

I used the Deis CLI to create two applications: [ghost](http://ghost.ci-demo.paulcz.net) from the code in the `master` branch, and [stage-ghost](http://stage-ghost.ci-demo.paulcz.net) from the code in the `development` branch. These are my `production` and `staging` environments, respectively.

Both the `development` and `master` branches are protected with GitHub settings that restrict changes from being pushed directly to the branch. Furthermore, any Pull Requests need to pass tests before they can be merged.

## Deis

Deploying applications with Deis is quite easy and very similar to deploying applications to Heroku. As long as your git repo has a `Dockerfile` (or supports being discovered by the [cedar](https://devcenter.heroku.com/articles/cedar) tooling), Deis will figure out what needs to be done to run your application.

Deploying an application with Deis is incredibly simple: 

1. First you use `deis create` to create an application (on success the Deis CLI will add a remote git endpoint).
2. Then you run `git push deis master` which pushes your code and triggers Deis to build and deploy your application.

```
$ git clone https://github.com/deis/example-go.git
$ cd example-go
$ deis login http://deis.xxxxx.com
$ deis create helloworld 
Creating Application... ...
done, created helloworld
Git remote deis added
$ git push deis master

Counting objects: 39, done.
Delta compression using up to 8 threads.
Compressing objects: 100% (38/38), done.
Writing objects: 100% (39/39), 5.17 KiB | 0 bytes/s, done.
Total 39 (delta 12), reused 0 (delta 0)

-----> Building Docker image
remote: Sending build context to Docker daemon 5.632 kB
<<<<<<<   SNIP   >>>>>>>
-----> Launching... 
       done, helloworld:v2 deployed to Deis
       http://helloworld.ci-demo.paulcz.net
```

## Jenkins

After running the Jenkins Docker container I had to do a few things to prepare it:

1. Run `docker exec -ti jenkins bash` to enter the container and install the Deis CLI tool and run `deis login` which saves a session file so that I don't have to login on every job.
2. Add the [GitHub Pull Request Builder](https://github.com/janinko/ghprb) (GHPRB) plugin.
3. Secure it with a password.
4. Run `docker commit` to commit the state of the Jenkins container.

I also had to create the jobs to perform the actual work. The GHPRB plugin made this fairly simple and most of the actual jobs were variations of the same script:

```
#!/bin/bash

APP="ghost"
git checkout master

git remote add deis ssh://git@deis.ci-demo.paulcz.net:2222/${APP}.git
git push deis master | tee deis_deploy.txt
```

## Continuous Integration / Deployment

### Local Development

Docker's `docker-compose` is a great tool for quickly building development environments (combined with Docker Machine it can deploy locally, or to the cloud of your choice). I have placed a `docker-compose.yml` file in the git repo to launch a `mysql` container for the database, and a `ghost` container:

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

I also included an `aliases` file with some useful aliases for common tasks:

```
alias dc="docker-compose"
alias npm="docker-compose run --rm --no-deps ghost npm install --production"
alias up="docker-compose up -d mysql && sleep 5 && docker-compose up -d --force-recreate ghost"
alias test="docker run -ti --entrypoint='sh' --rm test /app/test"
alias build="docker-compose build"
```

Running the development environment locally is as simple as cloning the repo and calling a few commands from the `aliases` file. The following examples show how I added [s3 support for storing images](https://www.npmjs.com/package/ghost-s3-storage):

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

Docker Compose v1.5 allows variable substitution so I can pull AWS credentials from environment variables which means they don't need to be saved to git and each dev can use their own bucket etc. This is done by simply adding these lines to the [docker-compose.yml](https://github.com/paulczar/ci-demo/blob/development/docker-compose.yml) file in the `environment` section:

```
ghost:
  environment:
    S3_ACCESS_KEY_ID: ${S3_ACCESS_KEY_ID}
    S3_ACCESS_KEY: ${S3_ACCESS_KEY}
```

I then added the appropriate environment variables to my shell and ran `up` to spin up a local development environment of the application. Once it was running I was able to confirm that the plugin was working by uploading the following image to the s3 bucket via the Ghost image upload mechanism:

![](https://ci-demo-ghost-images.s3.amazonaws.com/2015/Nov/ghost_blog-1447652183265.png)

### Pull Request

All new work is done in feature branches. Pull Requests are made to the `development` branch of the git repo which Jenkins watches using the github pull request plugin (GHPR). The development process looks a little something like this:

```
$ git checkout -b s3_for_images
Switched to a new branch 's3_for_images'
```

[Here](https://github.com/paulczar/ci-demo/commit/90afc7ae266343709d7daed40a5f49de862905c5) I added the s3 module and edited the appropriate sections of the Ghost code. Following the GitHub flow I then created a Pull Request for this new feature.

```
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

![IMAGE OF GITHUB PR PAGE](https://ci-demo-ghost-images.s3.amazonaws.com/2015/Nov/github_show_pr_testing-1448031318823.png)

Jenkins will be notified when a developer opens a new Pull Request against the development branch and will kick off tests. Jenkins will then create and deploy an ephemeral application in Deis named for the Pull Request ID (PR-11-ghost).

![IMAGE JENKINS JOB](https://ci-demo-ghost-images.s3.amazonaws.com/2015/Nov/jenkins_pr_testing-1448031335825.png)

The ephemeral environment can be viewed at http://pr-xx-ghost.ci-demo.paulczar.net by anyone wishing to review the Pull Request. Subsequent updates to the PR will update the deployed application.

We can run some manual tests specific to the feature being developed (such as uploading photos) once the URL to the ephemeral application is live.

#### Staging

Jenkins will see that a Pull Request is merged into the development branch and will perform two jobs:

1. Delete the `ephemeral` environment for Pull Request as it is no longer needed.
2. Create and deploy a new release of the contents of the `development` branch to the `staging` environment in Deis (http://stage-ghost.ci-demo.paulczar.net).

![IMAGE JENKINS JOB](https://ci-demo-ghost-images.s3.amazonaws.com/2015/Nov/ci_staging_deploy-1448031350720.png)

![](https://ci-demo-ghost-images.s3.amazonaws.com/2015/Nov/stage_ghost-1448031723495.png)

_Originally when I started building this demo I had assumed that being able to perform actions on PR merges/closes would be simple, but I quickly discovered that __none of the CI tools, that I could find, supported performing actions on PR close__. Thankfully I was able to find a useful [blog](http://chloky.com/github-json-payload-in-jenkins/) post that described how to set up a custom job with a webhook that could process the GitHub payload._

#### Production

Promoting the build from `staging` to `production` is a two step process:

1. The user who wishes to promote it creates a pull request from the development branch to the master branch. Jenkins will see this and kick off some final tests.

![](https://ci-demo-ghost-images.s3.amazonaws.com/2015/Nov/PR_to_master-1448031582932.png)

2. Another user then has to merge that pull request which will fire off a Jenkins job to push the code to Deis which cuts a new release and deploys it to the `production` environment (http://ghost.ci-demo.paulczar.net).

![](https://ci-demo-ghost-images.s3.amazonaws.com/2015/Nov/ci_prod_deploy-1448031629520.png)

## Conclusion

Coming from an operations background, I thought that figuring out how to build and run a PaaS from the metal up would be a really interesting learning exercise. It was! What I didn't expect to discover, however, was that actually running on application on that PaaS would be so compelling. Figuring out the development workflow and CI/CD pipeline was an eye-opener as well.

That said, the most interesting outcome of this exercise was increased empathy: the process of building and using this platform placed me directly in the shoes of the very developers I support. It further demonstrated that by changing the focus of the user experience to that person's core competency (the operator running the platform, and the developer using the platform) we allow the developer to "own" their application in production without them needing to worry about VMs, firewall rules, config management code, etc.

I also (re-)learned that while many of us default to cloud services such as AWS, Heroku, and Travis CI, there are solid alternatives that can be run in-house. I was also somewhat surprised at how powerful (and simple) Jenkins can be (even if it is still painful to automate).

I am grateful that Sysadvent gave me a reason to perform this little experiment. I learned a lot, and I hope that this article passes on some of that knowledge and experience to others.






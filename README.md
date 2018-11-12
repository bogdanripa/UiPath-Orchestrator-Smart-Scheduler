# UiPath-Orchestrator-Run-Queues
Node.js app that will automatically run a process when a queue item is added

## Installation / set-up instructions

1. make sure you install this on a computer that has a public IP address
2. git clone this repo
3. run "npm install" in the repo folder
4. edit the settings.json file and add your services. A service consists of a queue name, a process name, an environment name, and the maximum number of robots to run in paralel
5. run "sudo nodejs index.js" to execure the server. Once tested, you will need to make sure it runs continuously using somethnig like "forever". Google "forever nodejs" for details.
6. In Orchestrator (18.4 or newer), set-up 3 webhooks that will point to your endpoints:

* http://TYPE.YOUR.IP.ADDRESS/webhooks/jobs/created	subscribed to job.created
* http://TYPE.YOUR.IP.ADDRESS/webhooks/jobs/finished	subscribed to job.completed, job.faulted, job.stopped
* http://TYPE.YOUR.IP.ADDRESS/webhooks/queues/items/created	subscribed to queueItems.added


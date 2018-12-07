# UiPath Orchestrator Smart Scheduler
Node.js app that will manage schedules to:
* Automatically run a process when a queue item is added
* Link queue items, automatically creating new queue items when other queue item(s) are marked as completed. Completed queue items output (in aggregate) becomes the input for the new queue item
* Start a process when another one has finished. The initial process's output becomes the input for your new process

## Installation / set-up instructions

1. make sure you install this on a computer that has a public IP address
2. git clone this repo
3. run "npm install" in the repo folder
4. edit the settings.json file and
4.1. add your services. A service consists of a queue name, a process name, an environment name, and the maximum number of robots to run in paralel
4.2. add queue links. The input represent the queue(s) that you want to monitor for completed items. The output represents the queue(s) where you want new queue items to be added. Queue items are matched by reference.
4.3. add process links. The input represent the process you want to monitor for completion. the output represents the process(es) you want to start.
5. also in settings.json, update the Orchestrator connectivity details and the webhooks secret key
6. run "sudo nodejs index.js" to start the server. Once tested, you will need to make sure it runs continuously using somethnig like "forever". Google "forever nodejs" for details.
7. In Orchestrator (2018.4 or newer), set-up 4 webhooks that will point to your endpoints:

* http://TYPE.YOUR.IP.ADDRESS/webhooks/jobs/created	subscribed to job.created
* http://TYPE.YOUR.IP.ADDRESS/webhooks/jobs/finished	subscribed to job.completed, job.faulted, job.stopped
* http://TYPE.YOUR.IP.ADDRESS/webhooks/queues/items/created	subscribed to queueItems.added
* http://TYPE.YOUR.IP.ADDRESS/webhooks/queues/items/completed	subscribed to queueItem.transactionCompleted

8. In Orchestrator, make sure that your API user (as defined in settings.json) has the right to view processes, queues, transactions and jobs, and to create transaction and jobs

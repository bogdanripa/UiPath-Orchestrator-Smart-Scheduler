# UiPath Orchestrator Smart Scheduler
Node.js app that will manage schedules to:
* Automatically run a process when a queue item is added
* Start a process when another one has finished. The initial process's output becomes the input for your new process
* Automatically retry processes that fail
* Link queue items, automatically creating new queue items when other queue item(s) are marked as completed. Completed queue items output (in aggregate) becomes the input for the new queue item

See the [settings.json](settings.json) file for details on how to set those up.

## Installation / set-up instructions

**! The easiest way to deply this is using Google Cloud's App Engine: https://cloud.google.com/appengine/**

1. In Google Cloud / App Engine, create a new empty project and connect to it
2. git clone this repo and go in it's folder
3. run "npm install"
4. edit the settings.json file and
   1. add your services. A service consists of a queue name, a process name, an environment name, and the maximum number of robots to run in paralel. This is how you start a process when queue items are added.
   2. add process links. The input represent the process you want to monitor for completion. the output represents the process(es) you want to start whwen the previous one finishes succesfully.
   3. add process retries. This is how you retry a process on fail. Warning! When a process is retried, its input arguments are lost (at least for now)
   4. add queue links. The input represent the queue(s) that you want to monitor for completed items. The output represents the queue(s) where you want new queue items to be added. Queue items are matched by reference.
5. also in settings.json, update the Orchestrator connectivity details and the webhooks secret key
6. run "gcloud app deploy" to deploy your service
7. In Orchestrator (2018.4 or newer), set-up 4 webhooks that will point to your endpoints:

* http://PROJECTNAME.appspot.com/webhooks/jobs/created	subscribed to job.created
* http://PROJECTNAME.appspot.com/webhooks/jobs/finished	subscribed to job.completed, job.faulted, job.stopped
* http://PROJECTNAME.appspot.com/webhooks/queues/items/created	subscribed to queueItems.added
* http://PROJECTNAME.appspot.com/webhooks/queues/items/completed	subscribed to queueItem.transactionCompleted

8. In Orchestrator, make sure that your API user (as defined in settings.json) has the right to view processes, queues, transactions and jobs, and to create transaction and jobs

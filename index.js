var net = require('net');
var fs = require('fs');
var stringify = require('json-stringify-safe');
var util = require('util');
var Orchestrator = require('uipath-orchestrator');
const express = require('express');
var bodyParser = require('body-parser');
var pConnect;

var app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

//var settingsFile = process.argv[1].replace(/\/[^\/]+$/, "/settings.json");
var settings = require('./settings.json');
var orchestrator = new Orchestrator(settings.connection);

function getRunningJobs(service) {
	return new Promise(function (fulfill, reject){
		orchestrator.v2.odata.getJobs({"$filter": "ReleaseName eq '"+service.processName+"_"+service.environmentName+"' and (State eq 'Pending' or State eq 'Running')", "$top": 0, "$count": "true"}, function(err, data) {
			if (err) {
				reject(err);
			} else {
				try {
					service.count = data["@odata.count"];
					fulfill();
				} catch(err) {
					reject("Malformed response: Cannot get jobs count");
				}
			}
		});
	});
}

function getProcessKey(service) {
	return new Promise(function (fulfill, reject){
		orchestrator.v2.odata.getReleases({"$filter": "ProcessKey eq '" + service.processName + "' and EnvironmentName eq '" + service.environmentName + "'"}, function(err, data) {
			if (err) {
				reject(err);
			} else {
				try {
					service.key = data.value[0].Key;
					fulfill();
				} catch(err) {
					reject("Malformed response: Cannot get process key");
				}
			}
		});
	});
}

// gets number of running jobs and process keys for all processes
function getProcessDetails() {
	return new Promise(function (fulfill, reject){
		var servicesPromises = [];
		settings.services.forEach(function(service) {
			servicesPromises.push(getRunningJobs(service));
			if (!service.key) {
				servicesPromises.push(getProcessKey(service));
			}
		});
		Promise.all(servicesPromises)
			.then(function() {
				console.log("Got all current running jobs details");
				fulfill();
			})
			.catch(reject);
	});
}

function startProcessing(service) {
	return new Promise(function (fulfill, reject){
		console.log(service.processName + ": " + service.count + " jobs running");
		console.log(service.processName + ": " + service.maxRobots + " max jobs");
		if (service.count >= service.maxRobots) {
			// no need to start new jobs, they are already running
			fulfill();
		}
		// get the number of items to be processed in this queue
		orchestrator.v2.odata.getRetrieveQueuesProcessingStatus({"$filter": "QueueDefinitionName eq '" + service.queueName + "'"}, function(err, data) {
			if (err) {
				reject(err);
			} else {
				try {
					var itemsToProcess = data.value[0].ItemsToProcess;
					console.log(service.queueName + ": " + itemsToProcess + " items to process");
					var newJobsCount = Math.min(itemsToProcess, service.maxRobots - service.count);
					console.log(service.processName + ": " + newJobsCount + " jobs to start");
					if (newJobsCount > 0) {
						startJobForQueue(service.queueName, newJobsCount);
					}
					fulfill();
				} catch(err) {
					reject("Malformed response: Cannot get Queue size");
				}
			}
		});
		fulfill();
	});
}

function startProcessingJobs() {
	return new Promise(function (fulfill, reject){
		var servicesPromises = [];
		settings.services.forEach(function(service) {
			servicesPromises.push(startProcessing(service));
		});
		Promise.all(servicesPromises)
			.then(function() {
				fulfill();
			})
			.catch(reject);
	});
}

function refresh() {
	return new Promise(function (fulfill, reject){
		getProcessDetails()
			.then(startProcessingJobs)
			.then(fulfill)
			.catch(reject);

	});
}

function init() {
	getProcessDetails()
		.then(function() {
			app.listen(80, "0.0.0.0", function() {console.log('Listening on port 80!')});
			startProcessingJobs();
			setInterval(refresh, settings.refreshInterval*1000);
		})
		.catch(function(err) {
			console.log(err);
		});
}

function checkSecretKey(signature) {
	// TODO: check secret key
	return true;
}


app.get('/', function(req, res) {
	res.send('Hello World!');
});

app.post('/webhooks/jobs/created', function(req, res) {
	if (!checkSecretKey(req.get('X-Orchestrator-Signature'))) {
		res.status(401);
		return;
	}

	req.body.Jobs.forEach(function(job) {
		var service = settings.services.find(function(service) {
			return job.ReleaseName == service.processName + "_" + service.environmentName;
		});
		if (service) {
			service.count++;
			console.log(job.ReleaseName + ": " + service.count);
		}
	});
	res.send();
});

app.post('/webhooks/jobs/finished', function(req, res) {
	if (!checkSecretKey(req.get('X-Orchestrator-Signature'))) {
		res.status(401);
		return;
	}

	var service = settings.services.find(function(service) {
		return req.body.Job.Release.Name == service.processName + "_" + service.environmentName;
	});
	if (service) {
		service.count--;
		console.log(req.body.Job.Release.Name + ": " + service.count);
	}
	res.send();
});

app.get('/webhooks/queues/items/created', function(req, res) {
	if (!checkSecretKey(req.get('X-Orchestrator-Signature'))) {
		res.status(401);
		return;
	}

	var queueName = "Customers"; // TODO: replace with the actual queue name once it is implemented

	startJobForQueue(queueName, 1);

	console.log(req.method + " " + req.originalUrl);
	console.log(req.body);
	console.log(req.headers);
	res.send();
});

function startJobForQueue(queueName, runs) {
	return new Promise(function (fulfill, reject){
		var key = '';
		var shouldRun = false;
	
		var service = settings.services.find(function(service) {
			return service.queueName == queueName;
		});
	
		if (service) {
			if (service.count + 1 > service.maxRobots) {
				res.send();
				return;
			}
			jobParams = {
				"startInfo": {
					"ReleaseKey": service.key,
					"Strategy": "JobsCount",
					"JobsCount": runs,
					"Source": "Schedule",
					"InputArguments": "{}"
				}
		
			};

			orchestrator.post("/odata/Jobs/UiPath.Server.Configuration.OData.StartJobs", jobParams, fulfill);
		} else {
			reject("No job found for queue " + queueName);
		}
	});
}

app.all('*', function(req, res) {
	console.log(req.method + " " + req.originalUrl);
	console.log(req.body);
	console.log(req.headers);
	res.status(404).send('Hmm... are you trying to hack me?');
});

init();


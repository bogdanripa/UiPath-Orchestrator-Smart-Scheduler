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

var settingsFile = process.argv[1].replace(/\/[^\/]+$/, "/settings.json");
var settings = {services: []};

function loadSettings() {
	return new Promise(function (fulfill, reject){
		fs.exists(settingsFile, function(exists){
			if (exists) {
				fs.readFile(settingsFile, function readFileCallback(err, data) {
					if (err){
						console.log("Error reading 'settings.json': " + err);
						reject();
					} else {
						settings = JSON.parse(data);
						orchestrator = new Orchestrator(settings.connection);
						fulfill();
					}
				});
			} else {
				reject();
			}
		});
	});
}

function getRunningJobs(service) {
	return new Promise(function (fulfill, reject){
		orchestrator.v2.odata.getJobs({"$filter": "ReleaseName eq '"+service.processName+"_"+service.environmentName+"' and (State eq 'Pending' or State eq 'Running')", "$top": 0, "$count": "true"}, function(err, data) {
			// TODO: treat errors
			service.count = data["@odata.count"];
			fulfill();
		});
	});
}

function getProcessKey(service) {
	return new Promise(function (fulfill, reject){
		orchestrator.v2.odata.getReleases({"$filter": "ProcessKey eq '" + service.processName + "' and EnvironmentName eq '" + service.environmentName + "'"}, function(err, data) {
			// TODO: treat errors
			service.key = data.value[0].Key;
			fulfill();
		});
	});
}

function getJobExecutionCount() {
	return new Promise(function (fulfill, reject){
		var servicesPromises = [];
		settings.services.forEach(function(service) {
			servicesPromises.push(getRunningJobs(service));
			if (!service.key) {
				servicesPromises.push(getProcessKey(service));
			}
		});
		Promise.all(servicesPromises).then(function() {
			console.log("Got all current running jobs details");
			fulfill();
		});
	});
}


function init() {
	loadSettings()
		.then(getJobExecutionCount)
		.then(function() {
			setInterval(getJobExecutionCount, settings.refreshInterval*1000);
			app.listen(80, "0.0.0.0", function() {console.log('Listening on port 80!')});
		});
}


app.get('/', function(req, res) {
	res.send('Hello World!');
});

app.post('/webhooks/jobs/created', function(req, res) {
	// TODO: treat errors
	// TODO: check secret key
	req.body.Jobs.forEach(function(job) {
		settings.services.forEach(function(service) {
			if (job.ReleaseName == service.processName + "_" + service.environmentName) {
				service.count++;
				console.log(job.ReleaseName + ": " + service.count);
			}
		});
	});
	res.send();
});

app.post('/webhooks/jobs/finished', function(req, res) {
	// TODO: treat errors
	// TODO: check secret key
	settings.services.forEach(function(service) {
		if (req.body.Job.Release.Name == service.processName + "_" + service.environmentName) {
			service.count--;
			console.log(req.body.Job.Release.Name + ": " + service.count);
		}
	});
	res.send();
});

app.all('/webhooks/queues/items/created', function(req, res) {
	var queueName = "Customers"; // TODO: replace with the actual queue name once it is implemented
	var key = '';
	var shouldRun = false;
	settings.services.forEach(function(service) {
		if (service.queueName == queueName) {
			key = service.key;
			shouldRun = (service.count < service.maxRobots);
		}
	});
	if (!shouldRun) {
		res.send();
		return;
	}
	jobParams = {
		"startInfo": {
			"ReleaseKey": key,
			"Strategy": "JobsCount",
			"JobsCount": 1,
			"Source": "Schedule",
			"InputArguments": "{}"
		}

	};

	orchestrator.post("/odata/Jobs/UiPath.Server.Configuration.OData.StartJobs", jobParams, function() {
	});

	console.log(req.method + " " + req.originalUrl);
	console.log(req.body);
	console.log(req.headers);
	res.send();
});

app.all('*', function(req, res) {
	console.log(req.method + " " + req.originalUrl);
	console.log(req.body);
	console.log(req.headers);
	res.status(404).send('Hmm... are you trying to hack me?');
});

init();


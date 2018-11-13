const express = require('express');
var bodyParser = require('body-parser');
var Services = require('./Services.js');

var app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

//var settingsFile = process.argv[1].replace(/\/[^\/]+$/, "/settings.json");
var settings = require('./settings.json');
var services = new Services(settings);

// in case a webhook api call is missed, or if queue items become available to be processed (ex: the ones that were delayed), the jobs count cash is refreshed, and new jobs are started as needed
function refresh() {
	return new Promise(function (fulfill, reject){
		services.getProcessDetails()
			.then(services.startProcessingJobs)
			.then(fulfill)
			.catch(reject);

	});
}

function init() {
	// get the number of jobs currently running or pending for all services
	services.getProcessDetails()
		.then(function() {
			app.listen(80, "0.0.0.0", function() {console.log('Listening on port 80!')});
			services.startProcessingJobs();
			setInterval(refresh, settings.refreshInterval*1000);
		})
		.catch(function(err) {
			console.log(err);
		});
}

// checks signature to authenticate the caller (UiPath)
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
		services.onJobCreated(job.ReleaseName);
	});
	res.send();
});

app.post('/webhooks/jobs/finished', function(req, res) {
	if (!checkSecretKey(req.get('X-Orchestrator-Signature'))) {
		res.status(401);
		return;
	}

	services.onJobFinished(req.body.Job.Release.Name);

	res.send();
});

app.get('/webhooks/queues/items/created', function(req, res) {
	if (!checkSecretKey(req.get('X-Orchestrator-Signature'))) {
		res.status(401);
		return;
	}

	var queueName = "Customers"; // TODO: replace with the actual queue name once it is implemented

	services.startJobForQueue(queueName, 1);

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


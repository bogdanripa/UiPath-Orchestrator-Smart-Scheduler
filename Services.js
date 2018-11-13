var Orchestrator = require('uipath-orchestrator');

function Services(settings) {
	this.settings = settings;
	this.orchestrator = new Orchestrator(settings.connection);
}

// updates the service object with the number of jobs currently running
Services.prototype.getRunningJobs = function(service) {
	return new Promise(function (fulfill, reject){
		this.orchestrator.v2.odata.getJobs({"$filter": "ReleaseName eq '"+service.processName+"_"+service.environmentName+"' and (State eq 'Pending' or State eq 'Running')", "$top": 0, "$count": "true"}, function(err, data) {
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
	}.bind(this));
}

// updates the service object with the process key, needed for further API calls
Services.prototype.getProcessKey = function(service) {
	return new Promise(function (fulfill, reject){
		this.orchestrator.v2.odata.getReleases({"$filter": "ProcessKey eq '" + service.processName + "' and EnvironmentName eq '" + service.environmentName + "'"}, function(err, data) {
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
	}.bind(this));
}

// gets number of running jobs and process keys for all services
Services.prototype.getProcessDetails = function() {
	return new Promise(function (fulfill, reject){
		var servicesPromises = [];
		this.settings.services.forEach(function(service) {
			servicesPromises.push(this.getRunningJobs(service));
			if (!service.key) {
				servicesPromises.push(this.getProcessKey(service));
			}
		}.bind(this));
		Promise.all(servicesPromises)
			.then(function() {
				console.log("Got all current running jobs details");
				fulfill();
			})
			.catch(reject);
	}.bind(this));
}

// Start processing for a service.
// This will try to strat as many jobs as possible to process asap the items in the corresponding queue
Services.prototype.startProcessing = function(service) {
	return new Promise(function (fulfill, reject){
		console.log(service.processName + ": " + service.count + " jobs running");
		console.log(service.processName + ": " + service.maxRobots + " max jobs");
		if (service.count >= service.maxRobots) {
			// no need to start new jobs, they are already running
			fulfill();
		}
		// get the number of items to be processed in this queue
		this.orchestrator.v2.odata.getRetrieveQueuesProcessingStatus({"$filter": "QueueDefinitionName eq '" + service.queueName + "'"}, function(err, data) {
			if (err) {
				reject(err);
			} else {
				try {
					var itemsToProcess = data.value[0].ItemsToProcess;
					console.log(service.queueName + ": " + itemsToProcess + " items to process");
					var newJobsCount = Math.min(itemsToProcess, service.maxRobots - service.count);
					console.log(service.processName + ": " + newJobsCount + " jobs to start");
					if (newJobsCount > 0) {
						this.startJobForQueue(service.queueName, newJobsCount);
					}
					fulfill();
				} catch(err) {
					reject("Malformed response: Cannot get Queue size");
				}
			}
		}.bind(this));
		fulfill();
	}.bind(this));
}

// starts processing jobs for all services
Services.prototype.startProcessingJobs = function() {
	return new Promise(function (fulfill, reject){
		var servicesPromises = [];
		this.settings.services.forEach(function(service) {
			servicesPromises.push(this.startProcessing(service));
		}.bind(this));
		Promise.all(servicesPromises)
			.then(function() {
				fulfill();
			})
			.catch(reject);
	}.bind(this));
}

// queues a number of jobs for a specific process corresponding to a queue name
Services.prototype.startJobForQueue = function(queueName, runs) {
	return new Promise(function (fulfill, reject){
		var key = '';
		var shouldRun = false;
	
		var service = this.settings.services.find(function(service) {
			return service.queueName == queueName;
		});
	
		if (service) {
			if (service.count + 1 > service.maxRobots) {
				fulfill();
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

			this.orchestrator.post("/odata/Jobs/UiPath.Server.Configuration.OData.StartJobs", jobParams, fulfill);
		} else {
			reject("No job found for queue " + queueName);
		}
	}.bind(this));
}

Services.prototype.onJobFinished = function(jobName) {
	var service = this.settings.services.find(function(service) {
		return jobName == service.processName + "_" + service.environmentName;
	});
	if (service) {
		service.count--;
		console.log(jobName + ": is running " + service.count + " times");
	}
}

Services.prototype.onJobCreated = function(jobName) {
	var service = this.settings.services.find(function(service) {
		return jobName == service.processName + "_" + service.environmentName;
	});
	if (service) {
		service.count++;
		console.log(jobName + ": is running " + service.count + " times");
	}
}

module.exports = Services;


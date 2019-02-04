var Orchestrator = require('uipath-orchestrator');

function Services(settings) {
	this.settings = settings;
	this.settings.queues = {};
	this.settings.processes = {};
	this.orchestrator = new Orchestrator(settings.connection);
}

function odataEscape(str) {
	return str.replace(/'/g, "''");
}

Services.prototype.getJobDetails = function(jobId) {
	return new Promise(function (fulfill, reject){
		this.orchestrator.v2.odata.getJob(jobId, {}, function(err, data) {
			if (err) {
				reject(err);
			} else {
				fulfill(data);
			}
		});
	}.bind(this));
}

// updates the service object with the number of jobs currently running
Services.prototype.getRunningJobs = function(service) {
	return new Promise(function (fulfill, reject){
		this.orchestrator.v2.odata.getJobs({"$filter": "ReleaseName eq '" + odataEscape(service.processName) + "_" + odataEscape(service.environmentName) + "' and (State eq 'Pending' or State eq 'Running')", "$top": 0, "$count": "true"}, function(err, data) {
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
Services.prototype.getProcessKey = function(processName, environmentName) {
	return new Promise(function (fulfill, reject){
		if (this.settings.processes[processName + "_" + environmentName]) {
			fulfill();
			return;
		}
		this.orchestrator.v2.odata.getReleases({"$filter": "ProcessKey eq '" + odataEscape(processName) + "' and EnvironmentName eq '" + odataEscape(environmentName) + "'"}, function(err, data) {
			if (err) {
				reject(err);
			} else {
				try {
					this.settings.processes[processName + "_" + environmentName] = data.value[0].Key;
					fulfill();
				} catch(err) {
					reject("Malformed response: Cannot get process key for " + processName +" on " + environmentName + ": " + err);
				}
			}
		}.bind(this));
	}.bind(this));
}

// updates the service object with the queue Id
Services.prototype.getQueueId = function(queueName) {
	return new Promise(function (fulfill, reject){
		this.orchestrator.v2.odata.getQueueDefinitions({"$filter": "Name eq '" + odataEscape(queueName) + "'"}, function(err, data) {
			if (err) {
				reject(err);
			} else {
				try {
					this.settings.queues[queueName] = data.value[0].Id;
					fulfill();
				} catch(err) {
					reject("Malformed response: Cannot get queue dewfinition for " + queueName);
				}
			}
		}.bind(this));
	}.bind(this));
}

// gets number of running jobs and process keys for all services
Services.prototype.getProcessDetails = function() {
	return new Promise(function (fulfill, reject){
		var servicesPromises = [];
		this.settings.services.forEach(function(service) {
			servicesPromises.push(this.getRunningJobs(service));
			if (!this.settings.processes[service.processName + "_" + service.environmentName]) {
				servicesPromises.push(this.getProcessKey(service.processName, service.environmentName));
			}
			if (!this.settings.queues[service.queueName]) {
				servicesPromises.push(this.getQueueId(service.queueName));
			}
		}.bind(this));

		this.settings.processRetries.forEach(function(process) {
			servicesPromises.push(this.getProcessKey(process.processName, process.environmentName));
		}.bind(this));

		this.settings.processLinks.forEach(function(processLink) {
			processLink.output.forEach(function(linkOutput) {
				servicesPromises.push(this.getProcessKey(linkOutput.processName, linkOutput.environmentName));
			}.bind(this));
			servicesPromises.push(this.getProcessKey(processLink.input.processName, processLink.input.environmentName));
		}.bind(this));

		Promise.all(servicesPromises)
			.then(function() {
				console.log("Got all current running jobs details");
				fulfill();
			})
			.catch(reject);
	}.bind(this));
}

Services.prototype.getQueueDetails = function() {
	return new Promise(function (fulfill, reject){
		var queuePromises = [];
		this.settings.queueLinks.forEach(function(queueLink) {
			queueLink.input.forEach(function(queueName) {
				if (!this.settings.queues[queueName]) {
					queuePromises.push(this.getQueueId(queueName));
				}
			}.bind(this));

			queueLink.output.forEach(function(queueName) {
				if (!this.settings.queues[queueName]) {
					queuePromises.push(this.getQueueId(queueName));
				}
			}.bind(this));
		}.bind(this));
		Promise.all(queuePromises)
			.then(function() {
				console.log("Got all current queue details");
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
						this.startJobForQueue(this.settings.queues[service.queueName], newJobsCount);
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

Services.prototype.startJob = function(jobName, environmentName, runs, inputArgs) {
	console.log("Starting " + jobName + " on " + environmentName + " " + runs + " time(s) with " + JSON.stringify(inputArgs));
	this.getProcessKey(jobName, environmentName).then(function() {
		jobParams = {
			"startInfo": {
				"ReleaseKey": this.settings.processes[jobName + "_" + environmentName],
				"Strategy": "JobsCount",
				"JobsCount": runs,
				"Source": "Schedule",
				"InputArguments": JSON.stringify(inputArgs)
			}
		};
	
		this.orchestrator.post("/odata/Jobs/UiPath.Server.Configuration.OData.StartJobs", jobParams, function(err, data){
			if (err) {
				console.log(err);
			}
		});
	}.bind(this)).catch(function(e) {
		console.log(e);
	});
};

// queues a number of jobs for a specific process corresponding to a queue id
Services.prototype.startJobForQueue = function(queueId, runs) {
	var key = '';
	var shouldRun = false;

	var service = this.settings.services.find(function(service) {
		return this.settings.queues[service.queueName] == queueId;
	}.bind(this));

	if (service) {
		if (service.count + 1 > service.maxRobots) {
			console.log(service.queueName + ": max robots reached");
			return;
		}
		this.startJob(service.processName, service.environmentName, runs, {});
	}
}

Services.prototype.onJobFinished = function(job) {
	var jobName;
	if (!job) return;
	Object.keys(this.settings.processes).forEach(function(processName) {
		if (this.settings.processes[processName] == job.Release.Key) {
			jobName = processName;
		}
	}.bind(this));

	var service = this.settings.services.find(function(service) {
		return jobName == service.processName + "_" + service.environmentName;
	});
	if (service) {
		service.count--;
		console.log(jobName + ": is running " + service.count + " time(s)");
	}

	var processRetry = this.settings.processRetries.find(function(process) {
		return jobName == process.processName + "_" + process.environmentName;
	});

	switch (job.State) {
		case "Successful":

			if (processRetry) {
				processRetry.failCount = 0;
			}

			var processLink = this.settings.processLinks.find(function(processLink) {
				return jobName == processLink.input.processName + "_" + processLink.input.environmentName;
			});
			if (processLink) {
				processLink.output.forEach(function(outputLink) {
					this.startJob(outputLink.processName, outputLink.environmentName, 1, job.OutputArguments);
				}.bind(this));
			}
			break;
		case "Faulted":
			if (processRetry) {
				if (!processRetry.failCount) {
					processRetry.failCount = 0;
				}
				processRetry.failCount++;
				if (processRetry.failCount <= processRetry.retries) {
					this.getJobDetails(job.id).then(function(inputArgsStr) {
						console.log("Process execution failed for " + processRetry.processName + " on " + processRetry.environmentName + ". Retrying...");
						this.startJob(processRetry.processName, processRetry.environmentName, 1, JSON.parse(inputArgsStr));
					}.bind(this));
				} else {
					console.log("Retry count exceded for " + processRetry.processName + " on " + processRetry.environmentName);
				}
			}
			break;
	}
}

Services.prototype.onJobCreated = function(jobName) {
	var service = this.settings.services.find(function(service) {
		return jobName == service.processName + "_" + service.environmentName;
	});
	if (service) {
		service.count++;
		console.log(jobName + ": is running " + service.count + " time(s)");
	}
}

function arrayContainsArray (superset, subset) {
				  if (0 === subset.length) {
									    return false;
									  }
				  return subset.every(function (value) {
									    return (superset.indexOf(value) >= 0);
									  });
}

Services.prototype.checkQueueLinks = function(queue) {
	var partOfALink = false;
	var queueLinks = [];
	this.settings.queueLinks.forEach(function(queueLink) {
		queueLink.input.forEach(function(queueName) {
			if (queue.QueueDefinitionId == this.settings.queues[queueName]) {
				queueLinks.push(queueLink);
				partOfALink = true;
			}
		}.bind(this));
	}.bind(this));

	if (partOfALink) {
		this.orchestrator.v2.odata.getQueueItems({"$filter": "Reference eq '" + queue.Reference + "' and Status eq 'Successful'"}, function(err, data) {
			if (err) {
				console.log(err);
			} else {
				try {
					var queueIDs = {};
					var queueNames = [];
					var queueOutput = {};
					data.value.forEach(function(queueItem) {
						if (!queueOutput[queueItem.QueueDefinitionId]) {
							queueIDs[queueItem.QueueDefinitionId] = true;
							queueOutput = Object.assign(queueOutput, queueItem.Output);
						}
					}.bind(this));

					Object.keys(this.settings.queues).forEach(function(queueName) {
						if (queueIDs[this.settings.queues[queueName]]) {
							queueNames.push(queueName);
						}
					}.bind(this));

					queueLinks.forEach(function(queueLink) {
						if (arrayContainsArray(queueNames, queueLink.input)) {
							// all items were processed, create new queue item

							queueLink.output.forEach(function(queueName) {
								var newQueueItem = {
									"itemData": {
										"Name": queueName,
										"SpecificContent": queueOutput,
										"Reference": queue.Reference
									}
								};
								this.orchestrator.v2.odata.postAddQueueItem(newQueueItem, function(err, data) {
									if (err) {
										if (data && data.message) {
											console.log(data.message);
											return;
										}
										console.log(err);
										return;
									}
									console.log("Queue Link matched, created new queue item");
								});
							}.bind(this));
						}
					}.bind(this));

				} catch(err) {
					console.log("Malformed response: Cannot get queue items by reference: " + err);
				}
			}
		}.bind(this));
		
	}
}

module.exports = Services;


let axios = require("axios");

class RequestScheduler {
  /**
   * Create a RequestScheduler that sends performs web requests in line with a delay specified.
   * @param {number} delay delay in ms
   * @param {number} [priorityLevels=3] number of priority levels
   */
  constructor(delay,priorityLevels = 3) {
    this.delay = delay;
    this.extraRequests = 0;
    this.reqsRemaining = 120;
    setInterval(() => {this.makeRequest()}, delay);
    this.reqs = Array.from({length: 3}, () => []);
  }
  async makeRequest() {
    if (this.extraRequests < 0) { //if the extra-requests system over-corrected
      this.extraRequests++;
      return;
    }
    let req = this.reqs.flat()[0]; //flatten this.reqs and grab the first one
    if (req) {
      this.reqs[req.priority].splice(this.reqs[req.priority].indexOf(req),1); //remove the req from the queue
      if (this.reqs.flat().length > 0 && this.extraRequests > 1) { //check to see if we want to do it again
        this.extraRequests--;
        this.makeRequest();
      }
      try {
        let axiosResp = await axios[req.method](req.url);
        if (this.reqsRemaining == 0 || Number(axiosResp.headers["ratelimit-remaining"]) <= this.reqsRemaining) {
          this.reqsRemaining = Number(axiosResp.headers["ratelimit-remaining"]);
          this.extraRequests = Math.floor(this.reqsRemaining - axiosResp.headers["ratelimit-reset"] * 1000 / this.delay);
        }
        req.res(axiosResp); //request from the url and resolve the promise returned from .get with the data from the web request
      } catch (err) {
        req.timeout *= 2;
        setTimeout(() => {
          this.reqs[req.priority].push(req);
        },req.timeout)
        console.log("error requesting to url " + req.url)
      }
    }
  }
  /**
   * 
   */
  async get(url,priority=0) { //make an axios-like request that adheres to the delay specified in the constructor
    let resolutionFunction;
    let promise = new Promise((res,rej) => { //make a promise to return
      resolutionFunction = res; //put the resolution function into a wider scope
    })
    this.reqs[priority].push({
      priority: priority,
      method: "get",
      url: url,
      res: resolutionFunction,
      timeout: 2000
    })
    return promise;
  }
  async getFirst(url,priority=0) { //same as get but unshift instead of push
    let resolutionFunction;
    let promise = new Promise((res,rej) => { //make a promise to return
      resolutionFunction = res; //put the resolution function into a wider scope
    })
    this.reqs[priority].unshift({
      priority: priority,
      method: "get",
      url: url,
      res: resolutionFunction,
      timeout: 2000
    })
    return promise;
  }
}
exports.RequestScheduler = RequestScheduler;

module.exports = function(homebridge) {
  const Service = homebridge.hap.Service
  const Characteristic = homebridge.hap.Characteristic

  class AlertAlarmPlatform {
    constructor(log, config) {
      this.log = log
      this.config = config
    }

    accessories(callback) {
      callback([])
    }
  }

  homebridge.registerPlatform('homebridge-alert-alarm', 'AlertAlarm', AlertAlarmPlatform)
}

const AlertAlarmApi = require('./api')

module.exports = function(homebridge) {
  const Service = homebridge.hap.Service
  const Characteristic = homebridge.hap.Characteristic

  class AlertAlarmAccessory {
    constructor(platform, device) {
      this.platform = platform
      this.device = device
      this.id = device.radio_code
      this.name = device.name || null
    }

    identify(callback) {
      this.platform.log('AlertAlarmAccessory identified')
      callback()
    }
  }

  class AlertAlarmThermometer extends AlertAlarmAccessory {
    constructor(platform, device) {
      super(platform, device)

      if (!this.name) {
        this.name = this.platform.config.name + ' Thermometer ' + this.id
      }
    }

    getServices() {
      const service = new Service.TemperatureSensor(this.name)

      service.getCharacteristic(Characteristic.CurrentTemperature)
        .setProps({ minValue: -100 })
        .setValue(21)

      return [service]
    }
  }

  class AlertAlarmPlatform {
    constructor(log, config) {
      this.log = log
      this.config = config
      this.api = new AlertAlarmApi(config)
    }

    accessories(callback) {
      const accessories = []

      this.api.get('/system/devices', { refresh: 'false' })
        .then(res => {
          for (let device of res.body.data) {
            if (device.temperature_measurements) {
              accessories.push(new AlertAlarmThermometer(this, device))
            }
          }

          callback(accessories)
        })
        .catch(err => {
          this.log('An error occurred while loading devices')
          throw err
        })
    }
  }

  homebridge.registerPlatform('homebridge-alert-alarm', 'AlertAlarm', AlertAlarmPlatform)
}

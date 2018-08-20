#!/usr/bin/env node

const AlertAlarmApi = require('../api')
const colors = require('colors/safe')
const commandLineArgs = require('command-line-args')
const homedir = require('os').homedir()

const { command, configPath, help, logSize } = commandLineArgs([
  {
    name: 'command',
    type: String,
    defaultOption: true,
  },
  {
    name: 'configPath',
    type: String,
    defaultValue: `${homedir}/.homebridge/config.json`,
  },
  {
    name: 'help',
    alias: 'h',
    type: Boolean,
  },
  {
    name: 'logSize',
    type: Number,
    defaultValue: 10,
  }
])

if (help || !command) {
  console.log('usage: load.js <command>')
  console.log('')
  console.log('Available commands: devices, log')
  console.log('')
  console.log('Options:')
  console.log('--configPath: Homebridge config file path')
  console.log('--logSize: Number of log entries to load (default: 10)')
  process.exit()
}

const homebridgeConfig = require(configPath)
if (!homebridgeConfig.platforms) {
  console.error(colors.red('No platforms defintion found in homebridge config'))
  process.exit(1)
}

let config = null

// for (const platform of homebridgeConfig.platforms) {
for (const platform of homebridgeConfig.oldPlatforms) {
  if (platform.platform === 'AlertAlarm') {
    config = platform
    break
  }
}

if (!config) {
  console.error(
    colors.red('No AlertAlarm platform definition found in homebridge config')
  )
  process.exit(1)
}

const api = new AlertAlarmApi(config)

if (command === 'devices') {
  api.get('/system/devices', { refresh: false })
    .then(res => {
      console.log(res.body.data)
    })
    .catch(err => {
      console.log(colors.red('Error loading devices:'), err.message)
      process.exit(1)
    })
} else if (command === 'log') {
  api.get('/log/recent', { count: logSize })
    .then(res => {
      console.log(res.body.data)
      for (const event of res.body.data) {
        if (event.log_type !== 'rssi' && event.log_type !== 'temperature' && event.log_type !== 'activation') {
          console.log(event)
        }
      }
    })
    .catch(err => {
      console.log(colors.red('Error loading log entries:'), err.message)
      process.exit(1)
    })
} else {
  console.log(colors.red(`Unknown command '${command}'`))
  process.exit(1)
}

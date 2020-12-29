#!/usr/bin/env node

'use strict';

/* global describe */
/* global before */
/* global after */
/* global it */

require('chromedriver');

var execSync = require('child_process').execSync,
    expect = require('expect.js'),
    path = require('path'),
    superagent = require('superagent'),
    { Builder, By, until } = require('selenium-webdriver'),
    { Options } = require('selenium-webdriver/chrome');

if (!process.env.USERNAME || !process.env.PASSWORD) {
    console.log('USERNAME and PASSWORD env vars need to be set');
    process.exit(1);
}

describe('Application life cycle test', function () {
    this.timeout(0);

    const EXEC_ARGS = { cwd: path.resolve(__dirname, '..'), stdio: 'inherit' };
    const LOCATION = 'test';
    const TEST_TIMEOUT = 10000;
    const TEST_FILE_NAME_0 = 'index.html';
    const TEST_FILE_NAME_1 = 'test.txt';
    const CLI = path.join(__dirname, '/../cli/surfer.js');

    var browser;
    var app;

    before(function () {
        browser = new Builder().forBrowser('chrome').setChromeOptions(new Options().windowSize({ width: 1280, height: 1024 })).build();
    });

    after(function () {
        browser.quit();
    });

    function getAppInfo() {
        var inspect = JSON.parse(execSync('cloudron inspect'));
        app = inspect.apps.filter(function (a) { return a.location.indexOf(LOCATION) === 0; })[0];
        expect(app).to.be.an('object');
    }

    function waitForElement(elem) {
        return browser.wait(until.elementLocated(elem), TEST_TIMEOUT).then(function () {
            return browser.wait(until.elementIsVisible(browser.findElement(elem)), TEST_TIMEOUT);
        });
    }

    // tests which are used more than once
    function login(done) {
        browser.manage().deleteAllCookies();
        browser.get('https://' + app.fqdn + '/_admin');

        waitForElement(By.id('usernameInput')).then(function () {
            browser.findElement(By.id('usernameInput')).sendKeys(process.env.USERNAME);
            browser.findElement(By.id('passwordInput')).sendKeys(process.env.PASSWORD);
            browser.findElement(By.id('loginButton')).click();

            waitForElement(By.id('burgerMenuButton')).then(function () {
                done();
            });
        });
    }

    function logout(done) {
        browser.get('https://' + app.fqdn + '/_admin');

        waitForElement(By.id('burgerMenuButton')).then(function () {
            browser.findElement(By.id('burgerMenuButton')).click();

            // wait for open animation
            browser.sleep(1000);

            waitForElement(By.xpath('//span[text() = "Logout"]')).then(function () {
                browser.findElement(By.xpath('//span[text() = "Logout"]')).click();

                waitForElement(By.id('usernameInput')).then(function () {
                    done();
                });
            });
        });
    }

    function checkFileIsListed(name, done) {
        browser.get('https://' + app.fqdn + '/_admin');

        waitForElement(By.xpath('//*[text()="' + name + '"]')).then(function () {
            done();
        });
    }

    function checkFileIsPresent(done) {
        browser.get('https://' + app.fqdn + '/' + TEST_FILE_NAME_0);

        waitForElement(By.xpath('//*[text()="test"]')).then(function () {
            done();
        });
    }

    function checkIndexFileIsServedUp(done) {
        browser.get('https://' + app.fqdn);

        waitForElement(By.xpath('//*[text()="test"]')).then(function () {
            done();
        });
    }

    function checkFileIsGone(name, done) {
        superagent.get('https://' + app.fqdn + '/' + name).end(function (error, result) {
            expect(error).to.be.an('object');
            expect(error.response.status).to.equal(404);
            expect(result).to.be.an('object');
            done();
        });
    }

    function cliLogin() {
        execSync(`${CLI} login ${app.fqdn} --username ${process.env.USERNAME} --password ${process.env.PASSWORD}`, { stdio: 'inherit' });
    }

    function uploadFile(name) {
        // File upload can't be tested with selenium, since the file input is not visible and thus can't be interacted with :-(
        execSync(`${CLI} put ${path.join(__dirname, name)} /`,  { stdio: 'inherit' } );
    }

    function checkFolderExists() {
        var result;
        result = execSync(`${CLI} get`).toString();
        expect(result.indexOf('test/')).to.not.equal(-1);
        result = execSync(`${CLI} get test/`).toString();
        expect(result.indexOf('test.txt')).to.not.equal(-1);
    }

    function checkFolderIsGone() {
        var result;
        result = execSync(`${CLI} get`).toString();
        expect(result.indexOf('test/')).to.equal(-1);
    }

    xit('build app', function () { execSync('cloudron build', EXEC_ARGS); });
    it('install app', function () { execSync(`cloudron install --location ${LOCATION}`, EXEC_ARGS); });

    it('can get app information', getAppInfo);

    it('can login', login);
    it('can cli login', cliLogin);
    it('can upload file', uploadFile.bind(null, TEST_FILE_NAME_0));
    it('file is listed', checkFileIsListed.bind(null, TEST_FILE_NAME_0));
    it('file is served up', checkFileIsPresent);
    it('file is served up', checkIndexFileIsServedUp);
    it('can upload second file', uploadFile.bind(null, TEST_FILE_NAME_1));
    it('file is listed', checkFileIsListed.bind(null, TEST_FILE_NAME_1));
    it('can delete second file with cli', function () {
        execSync(`${CLI} del ${TEST_FILE_NAME_1}`,  { stdio: 'inherit' });
    });
    it('second file is gone', checkFileIsGone.bind(null, TEST_FILE_NAME_1));
    it('can upload folder', uploadFile.bind(null, '.'));
    it('folder exists', checkFolderExists);
    it('can logout', logout);

    it('backup app', function () { execSync(`cloudron backup create --app ${app.id}`, EXEC_ARGS); });
    it('restore app', function () {
        const backups = JSON.parse(execSync(`cloudron backup list --raw --app ${app.id}`));
        execSync('cloudron uninstall --app ' + app.id, EXEC_ARGS);
        execSync('cloudron install --location ' + LOCATION, EXEC_ARGS);
        getAppInfo();
        execSync(`cloudron restore --backup ${backups[0].id} --app ${app.id}`, EXEC_ARGS);
    });

    it('can login', login);
    it('file is listed', checkFileIsListed.bind(null, TEST_FILE_NAME_0));
    it('file is served up', checkFileIsPresent);
    it('file is served up', checkIndexFileIsServedUp);
    it('second file is still gone', checkFileIsGone.bind(null, TEST_FILE_NAME_1));
    it('folder exists', checkFolderExists);
    it('can logout', logout);

    it('move to different location', function (done) {
        browser.manage().deleteAllCookies();

        // ensure we don't hit NXDOMAIN in the mean time
        browser.get('about:blank').then(function () {
            execSync(`cloudron configure --location ${LOCATION}2 --app ${app.id}`, EXEC_ARGS);
            done();
        });
    });
    it('can get app information', getAppInfo);

    it('can login', login);
    it('can cli login', cliLogin);
    it('file is listed', checkFileIsListed.bind(null, TEST_FILE_NAME_0));
    it('file is served up', checkFileIsPresent);
    it('file is served up', checkIndexFileIsServedUp);
    it('folder exists', checkFolderExists);
    it('can delete folder', function () { execSync(`${CLI}  del --recursive test`,  { stdio: 'inherit' }); });
    it('folder is gone', checkFolderIsGone);
    it('can logout', logout);

    it('uninstall app', function (done) {
        // ensure we don't hit NXDOMAIN in the mean time
        browser.get('about:blank').then(function () {
            execSync(`cloudron uninstall --app ${app.id}`, EXEC_ARGS);
            done();
        });
    });

    // test update
    it('can install app', function () {
        execSync(`cloudron install --appstore-id io.cloudron.surfer --location ${LOCATION}`, EXEC_ARGS);
    });

    it('can get app information', getAppInfo);
    it('can login', login);
    it('can cli login', cliLogin);
    it('can upload file', uploadFile.bind(null, TEST_FILE_NAME_0));
    it('file is listed', checkFileIsListed.bind(null, TEST_FILE_NAME_0));
    it('file is served up', checkFileIsPresent);
    it('file is served up', checkIndexFileIsServedUp);
    it('can logout', logout);

    it('can update', function () {
        execSync(`cloudron update --app ${LOCATION}`, EXEC_ARGS);
    });

    it('can login', login);
    it('file is listed', checkFileIsListed.bind(null, TEST_FILE_NAME_0));
    it('file is served up', checkFileIsPresent);
    it('file is served up', checkIndexFileIsServedUp);
    it('can logout', logout);

    it('uninstall app', function (done) {
        // ensure we don't hit NXDOMAIN in the mean time
        browser.get('about:blank').then(function () {
            execSync(`cloudron uninstall --app ${app.id}`, EXEC_ARGS);
            done();
        });
    });
});

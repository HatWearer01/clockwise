describe("Clockwise Smoke Tests", () => {
  describe("App Launch", () => {
    it("should display the Clockwise title", async () => {
      const heading = await $("h1=Clockwise");
      await heading.waitForDisplayed({ timeout: 10_000 });
      expect(await heading.isDisplayed()).toBe(true);
    });

    it("should show the Today tab content by default", async () => {
      const todayTab = await $("button.tab-active");
      await todayTab.waitForExist({ timeout: 5000 });
      expect(await todayTab.getText()).toBe("Today");
    });

    it("should display the Clock in button when idle", async () => {
      const clockInBtn = await $("button=Clock in");
      await clockInBtn.waitForDisplayed({ timeout: 5000 });
      expect(await clockInBtn.isDisplayed()).toBe(true);
    });
  });

  describe("Clock In / Out Flow", () => {
    it("should clock in and show active session state", async () => {
      const clockInBtn = await $("button=Clock in");
      await clockInBtn.waitForClickable({ timeout: 5000 });
      await clockInBtn.click();

      const clockOutBtn = await $("button=Clock out");
      await clockOutBtn.waitForDisplayed({ timeout: 5000 });
      expect(await clockOutBtn.isDisplayed()).toBe(true);

      // Break button appears when clocked in
      const breakBtn = await $("button=Take a break");
      await breakBtn.waitForDisplayed({ timeout: 5000 });
      expect(await breakBtn.isDisplayed()).toBe(true);
    });

    it("should take a break and show paused state", async () => {
      const breakBtn = await $("button=Take a break");
      await breakBtn.waitForClickable({ timeout: 5000 });
      await breakBtn.click();

      const resumeBtn = await $("button=Resume work");
      await resumeBtn.waitForDisplayed({ timeout: 5000 });
      expect(await resumeBtn.isDisplayed()).toBe(true);
    });

    it("should resume from break", async () => {
      const resumeBtn = await $("button=Resume work");
      await resumeBtn.waitForClickable({ timeout: 5000 });
      await resumeBtn.click();

      const breakBtn = await $("button=Take a break");
      await breakBtn.waitForDisplayed({ timeout: 5000 });
      expect(await breakBtn.isDisplayed()).toBe(true);
    });

    it("should clock out and return to idle state", async () => {
      const clockOutBtn = await $("button=Clock out");
      await clockOutBtn.waitForClickable({ timeout: 5000 });
      await clockOutBtn.click();

      const clockInBtn = await $("button=Clock in");
      await clockInBtn.waitForDisplayed({ timeout: 5000 });
      expect(await clockInBtn.isDisplayed()).toBe(true);
    });
  });

  describe("Tab Navigation", () => {
    it("should navigate to Schedule tab and display 7 days", async () => {
      const scheduleTab = await $("button=Schedule");
      await scheduleTab.waitForClickable({ timeout: 5000 });
      await scheduleTab.click();

      const heading = await $("h2=Schedule");
      await heading.waitForDisplayed({ timeout: 5000 });
      expect(await heading.isDisplayed()).toBe(true);

      const dayRows = await $$(".schedule-day-row");
      expect(dayRows.length).toBe(7);
    });

    it("should toggle a day off/on in Schedule", async () => {
      const dayRows = await $$(".schedule-day-row");
      const firstRow = dayRows[0];
      const toggleBtn = await firstRow.$("button.chip");
      const initialText = await toggleBtn.getText();

      await toggleBtn.click();
      await browser.pause(300);

      const newText = await toggleBtn.getText();
      expect(newText).not.toBe(initialText);

      // Toggle back
      await toggleBtn.click();
      await browser.pause(300);

      const restoredText = await toggleBtn.getText();
      expect(restoredText).toBe(initialText);
    });

    it("should navigate to Week tab and display data", async () => {
      const weekTab = await $("button=Week");
      await weekTab.waitForClickable({ timeout: 5000 });
      await weekTab.click();

      const heading = await $("h2=This Week");
      await heading.waitForDisplayed({ timeout: 5000 });
      expect(await heading.isDisplayed()).toBe(true);

      const weekRows = await $$(".week-row");
      expect(weekRows.length).toBe(7);
    });

    it("should navigate to Settings tab", async () => {
      const settingsTab = await $("button=Settings");
      await settingsTab.waitForClickable({ timeout: 5000 });
      await settingsTab.click();

      const heading = await $("h2=Settings");
      await heading.waitForDisplayed({ timeout: 5000 });
      expect(await heading.isDisplayed()).toBe(true);
    });

    it("should toggle the Theme setting", async () => {
      const lightBtn = await $("button=Light");
      await lightBtn.waitForClickable({ timeout: 5000 });
      await lightBtn.click();
      await browser.pause(300);

      expect(await lightBtn.getAttribute("class")).toContain("chip-active");

      const darkBtn = await $("button=Dark");
      await darkBtn.click();
      await browser.pause(300);

      expect(await darkBtn.getAttribute("class")).toContain("chip-active");
    });

    it("should return to Today tab", async () => {
      const todayTab = await $("button=Today");
      await todayTab.waitForClickable({ timeout: 5000 });
      await todayTab.click();

      const clockInBtn = await $("button=Clock in");
      await clockInBtn.waitForDisplayed({ timeout: 5000 });
      expect(await clockInBtn.isDisplayed()).toBe(true);
    });
  });

  describe("Mode Switch", () => {
    it("should switch to Compact mode", async () => {
      const compactBtn = await $("button*=Compact");
      await compactBtn.waitForClickable({ timeout: 5000 });
      await compactBtn.click();

      const compactView = await $(".compact-view");
      await compactView.waitForDisplayed({ timeout: 5000 });
      expect(await compactView.isDisplayed()).toBe(true);

      // Verify compact UI shows key elements
      const brand = await $(".brand");
      expect(await brand.isDisplayed()).toBe(true);
    });

    it("should show Clock in button in compact mode", async () => {
      const clockInBtn = await $("button=Clock in");
      await clockInBtn.waitForDisplayed({ timeout: 5000 });
      expect(await clockInBtn.isDisplayed()).toBe(true);
    });

    it("should switch back to Expanded mode", async () => {
      // The menu button in compact mode switches to expanded
      const menuBtn = await $(".compact-header button.ghost");
      await menuBtn.waitForClickable({ timeout: 5000 });
      await menuBtn.click();

      const expandedView = await $(".expanded-view");
      await expandedView.waitForDisplayed({ timeout: 5000 });
      expect(await expandedView.isDisplayed()).toBe(true);
    });
  });
});

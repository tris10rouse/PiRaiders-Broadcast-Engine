using System;

internal static class NdiFrameWindowTest
{
    private static void Check(bool value, string message)
    { if (!value) throw new Exception(message); }
    private static bool Frame(NdiFrameWindow window, long timestamp, long elapsedMs)
    { return window.Observe(timestamp, elapsedMs, true, true, true); }
    public static int Main()
    {
        NdiFrameWindow window = new NdiFrameWindow(3, 0, 20000);
        Check(!Frame(window, 10, 0) && !Frame(window, 11, 30), "initial partial run");
        Check(!window.Observe(12, 60, false, true, true), "pre-capture disconnect must reject buffered video");
        Check(window.MatchedFrames == 0, "disconnect resets count");
        Check(!Frame(window, 10, 90) && !Frame(window, 12, 120), "old timestamps receive no reconnect credit");
        Check(!Frame(window, 13, 150) && !Frame(window, 14, 180) && Frame(window, 15, 210), "fresh reconnect run");
        Check(!window.Observe(16, 240, true, false, true) && window.MatchedFrames == 0, "post-capture disconnect");
        Check(!Frame(window, 17, 270) && !Frame(window, 17, 400) && window.MatchedFrames == 1, "duplicates never advance count");
        Check(!window.Observe(18, 430, true, true, false) && window.MatchedFrames == 0, "pixel mismatch resets count");
        Check(!Frame(window, 19, 460), "new run after mismatch");
        window.Reset(); // The actual capture loop uses this for source/error notifications.
        Check(!Frame(window, 19, 490) && window.MatchedFrames == 0, "status reset retains replay history");
        Check(!Frame(window, 20, 520) && !Frame(window, 21, 550) && Frame(window, 22, 580), "fresh source run");
        Check(!window.ConfirmConnection(0, 581) && window.MatchedFrames == 0, "final Stats disconnect resets candidate");
        Check(!Frame(window, 22, 582) && !Frame(window, 23, 600) && !Frame(window, 24, 630) && Frame(window, 25, 660), "final disconnect demands full fresh run");
        Check(window.ConfirmConnection(1, 661), "positive final connection");

        window = new NdiFrameWindow(10, 1500, 20000);
        for (int n = 1; n <= 10; n++) Check(!Frame(window, n, n * 30), "frame count alone cannot satisfy black duration");
        Check(!window.Observe(11, 1700, true, false, true), "black disconnect resets duration");
        for (int n = 12; n <= 21; n++) Check(!Frame(window, n, 1800 + (n - 12) * 30), "old duration cannot satisfy new black run");
        Check(!Frame(window, 21, 3300), "duplicate cannot complete duration");
        Check(Frame(window, 22, 3300) && window.SampleDurationMs(3300) == 1500, "continuous fresh black run");

        window = new NdiFrameWindow(3, 0, 100);
        Check(!Frame(window, 1, 0) && !Frame(window, 2, 30), "budget partial run");
        Check(!Frame(window, 3, 100) && !window.WithinBudget(100), "capture at deadline cannot succeed");
        Check(!window.ConfirmConnection(1, 100), "final result cannot extend budget");
        window.Reset();
        Check(!Frame(window, 4, 101) && !window.WithinBudget(101), "reset never renews timeout");
        window = new NdiFrameWindow(3, 0, 20000);
        for (int n = 1; n <= 600; n++) Check(!window.Observe(n, n * 33, false, false, true), "permanent disconnect never passes");
        Check(window.MatchedFrames == 0 && !window.WithinBudget(20000), "permanent disconnect exhausts original budget");

        window = new NdiFrameWindow(1, 3000, 20000);
        for (int n = 1; n <= 512; n++) Check(!Frame(window, n, n), "bounded partial window");
        bool bounded = false;
        try { Frame(window, 513, 513); }
        catch (ProbeFailure failure) { bounded = failure.Code == "VIDEO_FRAME_LIMIT"; }
        Check(bounded && window.MatchedFrames == 512, "513th timestamp fails closed");
        window = new NdiFrameWindow(3, 0, 20000);
        Check(!Frame(window, 100, 0) && !Frame(window, 90, 30) && Frame(window, 80, 60), "distinct backwards timestamps retain original ordering-independent contract");
        window.Reset();
        Check(!Frame(window, 100, 90) && !Frame(window, 90, 120) && window.MatchedFrames == 0, "backwards replay cannot recover old credit");
        Check(!Frame(window, 3, 150) && !Frame(window, 2, 180) && Frame(window, 1, 210), "new distinct timestamps after epoch reset can succeed");
        window.Reset();
        Check(!Frame(window, -1, 240) && !Frame(window, -2, 270) && Frame(window, -3, 300), "valid negative distinct timestamps are not treated as an epoch error");
        window = new NdiFrameWindow(3, 0, 20000);
        for (int n = 1; n <= 2048; n++) Check(!window.Observe(n, n, false, false, true), "bounded disconnected history");
        bounded = false;
        try { window.Observe(2049, 2049, false, false, true); }
        catch (ProbeFailure failure) { bounded = failure.Code == "VIDEO_TIMESTAMP_LIMIT"; }
        Check(bounded, "timestamp history cap fails closed without eviction/replay");
        Console.WriteLine("NDI_FRAME_WINDOW_PASS");
        return 0;
    }
}

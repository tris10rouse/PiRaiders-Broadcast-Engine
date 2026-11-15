using System;

internal static class NativeWindowPolicyTest
{
    private static void Check(bool value) { if (!value) throw new Exception("WINDOW_POLICY_ASSERTION"); }
    private static void Invalid(long begin, long end)
    {
        try { new NativeProductionWindow(begin, end, 100, 900); }
        catch (ArgumentException) { return; }
        throw new Exception("WINDOW_POLICY_ACCEPTED_INVALID");
    }
    public static int Main()
    {
        NativeProductionWindow window = new NativeProductionWindow(1000, 2000, 100, 900);
        Check(window.Allows(1200, 100));
        Check(window.Allows(1000, 101)); // begin inclusive, rollback within interval
        Check(!window.Allows(999, 102)); // below prewarm closes
        Check(!window.Allows(2000, 103)); // end exclusive
        Check(!window.Allows(1900, 900)); // immutable monotonic budget closes despite UTC rollback
        Check(!window.Allows(1200, 99)); // contradictory monotonic evidence closes
        Check(window.Allows(1999, 899));
        Check(!window.Allows(1999, 901)); // includes suspend/elapsed time supplied by Tick64
        Check(!new NativeProductionWindow(1000, 2000, 100, 100).Allows(1999, 100));
        NativeProductionWindow restarted = new NativeProductionWindow(1000, 2000, 100, 900);
        Check(restarted.Allows(1200, 899));
        Check(!restarted.Allows(1200, 900)); // UTC rollback plus restart cannot reset cap
        try { new NativeProductionWindow(1000, 2000, 100, 99); throw new Exception("INVALID_TICK_ACCEPTED"); } catch (ArgumentException) { }
        try { new NativeProductionWindow(1000, 2000, 100, 9007199254740992UL); throw new Exception("INVALID_TICK_ACCEPTED"); } catch (ArgumentException) { }
        Invalid(1000, 1000); Invalid(2000, 1000); Invalid(0, 90000001);
        Invalid(-62135596800001L, -62135596800000L);
        Invalid(253402300799999L, 253402300800000L);
        Console.WriteLine("WINDOW_POLICY_PASS");
        return 0;
    }
}

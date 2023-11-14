package examples.arithmetics.llvm.fibonacci;

public class Fibonacci {

    private static int fib(int n) {
        if (n < 2) {
            return n;
        } else {
            return fib(n - 1) + fib(n - 2);
        }
    }

    public static void main(String[] args) {
        System.exit(fib(40) % 256);
    }
}

'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { testRLSPolicies } from '@/lib/test-rls';

export default function TestRLSPage() {
  const { user } = useAuth();
  const [testResults, setTestResults] = useState<string[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  const addResult = (result: string) => {
    setTestResults(prev => [...prev, result]);
  };

  // Override console.log to capture test output
  useEffect(() => {
    const originalConsoleLog = console.log;
    console.log = (...args) => {
      originalConsoleLog.apply(console, args);
      const formattedArgs = args.map(arg => {
        if (typeof arg === 'object') {
          return JSON.stringify(arg, null, 2);
        }
        return arg;
      });
      addResult(formattedArgs.join(' '));
    };

    return () => {
      console.log = originalConsoleLog;
    };
  }, []);

  const runTests = async () => {
    if (!user) {
      addResult('Please sign in to run tests');
      return;
    }

    setIsRunning(true);
    setTestResults([]);

    try {
      await testRLSPolicies();
    } catch (error) {
      addResult(`Error running tests: ${error}`);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">RLS Policy Tests</h1>
      
      {!user ? (
        <div className="text-red-500">Please sign in to run tests</div>
      ) : (
        <button
          onClick={runTests}
          disabled={isRunning}
          className="bg-blue-500 text-white px-4 py-2 rounded disabled:opacity-50"
        >
          {isRunning ? 'Running Tests...' : 'Run Tests'}
        </button>
      )}

      <div className="mt-4">
        <pre className="bg-gray-100 p-4 rounded overflow-auto">
          {testResults.join('\n')}
        </pre>
      </div>
    </div>
  );
} 
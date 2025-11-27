import React from 'react';
import { Loader2 } from 'lucide-react';

interface LoadingScreenProps {
  message?: string;
}

export const LoadingScreen: React.FC<LoadingScreenProps> = ({ 
  message = "Loading..." 
}) => {
  return (
    <div className="min-h-screen bg-gradient-background flex items-center justify-center">
      <div className="text-center space-y-4">
        <div className="bg-white/20 p-4 rounded-lg inline-block">
          <Loader2 className="h-8 w-8 animate-spin text-white" />
        </div>
        <p className="text-white/90 text-lg font-medium">{message}</p>
        <div className="flex space-x-2 justify-center">
          <div className="w-2 h-2 bg-white/60 rounded-full animate-bounce"></div>
          <div className="w-2 h-2 bg-white/60 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
          <div className="w-2 h-2 bg-white/60 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
        </div>
      </div>
    </div>
  );
};



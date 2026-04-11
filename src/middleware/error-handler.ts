import { Request, Response, NextFunction } from 'express';

export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
    console.error(`[Error] 
      Message: ${err.message}
      Stack: ${err.stack}
      URL: ${req.url}
      Method: ${req.method}
    `);

    // Standardized production-grade error response
    res.status(err.status || 500).json({
        error: err.name || 'InternalServerError',
        message: process.env.NODE_ENV === 'production' 
            ? 'An unexpected error occurred in the intelligence cluster.' 
            : err.message,
        code: err.code || 'UNKNOWN_ERROR',
        timestamp: new Date().toISOString()
    });
}

import { Request, Response, NextFunction } from 'express';

export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
    console.error(`[Error] 
      Message: ${err.message}
      Stack: ${err.stack}
      URL: ${req.url}
      Method: ${req.method}
    `);

    const isProduction = process.env.NODE_ENV === 'production';
    const status = isProduction && !(err.status >= 400 && err.status < 500) ? 500 : err.status || 500;

    // Standardized production-grade error response
    res.status(status).json({
        error: isProduction ? 'InternalServerError' : err.name || 'InternalServerError',
        message: isProduction
            ? 'An unexpected error occurred in the intelligence cluster.'
            : err.message,
        code: isProduction ? 'UNKNOWN_ERROR' : err.code || 'UNKNOWN_ERROR',
        timestamp: new Date().toISOString()
    });
}

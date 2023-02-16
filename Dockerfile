FROM runcitadel/deno:main
WORKDIR /app
COPY ./ /app
ENTRYPOINT ["deno"]
CMD ["run", "-A", "mod.ts"]
